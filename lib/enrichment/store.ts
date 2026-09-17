// Layer: persistence. Owns durable evidence, accounting, and guarded publication.
import "../assert-server";
import { createHash, randomUUID } from "node:crypto";
import type { Database, Sql } from "./db";
import {
  evidenceProvenance,
  stableDigest,
  type EvidenceInput,
} from "./contracts";

export type PaymentState = "pending" | "uncertain" | "settled" | "not_charged";
export type ArtifactKind =
  | "source_response"
  | "generation_request"
  | "generation_response"
  | "manifest"
  | "local_transform"
  | "legacy_import"
  | "tool_request"
  | "tool_response";
export interface Artifact {
  id: string;
  kind: ArtifactKind;
  body: Uint8Array;
  sha256: string;
  metadata: Record<string, unknown>;
}
export interface ArtifactInput {
  kind: ArtifactKind;
  body: Uint8Array;
  contentType: string;
  redactionVersion: string;
  attemptId?: string;
  runId?: string;
  importBatch?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}
export interface AnalysisInput {
  id?: string;
  entityId: string;
  releaseId: string;
  generation: number;
  purpose: string;
  inputArtifactId: string;
  inputDigest: string;
  recipeDigest: string;
  evidenceIds: string[];
  output: unknown;
  validationReport: unknown;
  status: "succeeded" | "failed" | "missing_input";
}
export type StageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "not_applicable"
  | "unavailable"
  | "blocked"
  | "failed"
  | "cancelled";
const hash = (body: Uint8Array | string) =>
  createHash("sha256").update(body).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
function money(value: string): string {
  if (!/^\d+$/.test(value))
    throw new Error("money must be nonnegative integer micro-units");
  return BigInt(value).toString();
}
async function one<T>(
  sql: Sql,
  query: string,
  args: unknown[] = [],
): Promise<T> {
  const row = (await sql.query<T>(query, args)).rows[0];
  if (!row) throw new Error("record not found or state conflict");
  return row;
}

export class EnrichmentStore {
  constructor(readonly db: Database) {}

  async createBudget(input: {
    id: string;
    scope: string;
    currency: string;
    capMicros: string;
  }) {
    await this.db.query(
      "INSERT INTO enrichment_budgets(id,scope,currency,cap_micros) VALUES($1,$2,$3,$4)",
      [input.id, input.scope, input.currency, money(input.capMicros)],
    );
  }
  async planCollection(input: {
    scope: string;
    fingerprint: string;
    generation: number;
    operation: string;
    args: unknown;
    policyId: string;
  }): Promise<{ id: string }> {
    return one(
      this.db,
      "INSERT INTO enrichment_collection_requests(id,scope,fingerprint,generation,operation,args,policy_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(scope,fingerprint,generation) DO UPDATE SET fingerprint=EXCLUDED.fingerprint WHERE enrichment_collection_requests.operation=EXCLUDED.operation AND enrichment_collection_requests.args=EXCLUDED.args AND enrichment_collection_requests.policy_id=EXCLUDED.policy_id RETURNING id",
      [
        randomUUID(),
        input.scope,
        input.fingerprint,
        input.generation,
        input.operation,
        json(input.args),
        input.policyId,
      ],
    );
  }
  async reserveAttempt(input: {
    requestId: string;
    budgetId: string;
    capMicros: string;
  }): Promise<{ id: string; clientKey: string; requestId: string }> {
    return this.db.transaction(async (tx) => {
      const request = await one<{ scope: string }>(
        tx,
        "SELECT scope FROM enrichment_collection_requests WHERE id=$1 FOR UPDATE",
        [input.requestId],
      );
      const existing = await tx.query(
        "SELECT id FROM enrichment_collection_attempts WHERE request_id=$1 AND dispatch_state <> 'not_charged'",
        [input.requestId],
      );
      if (existing.rows.length)
        throw new Error("request already reserved, captured, or uncertain");
      await one(
        tx,
        "UPDATE enrichment_budgets SET committed_micros=committed_micros+$2 WHERE id=$1 AND scope=$3 AND committed_micros+$2<=cap_micros RETURNING id",
        [input.budgetId, money(input.capMicros), request.scope],
      );
      const { ordinal } = await one<{ ordinal: number }>(
        tx,
        "SELECT coalesce(max(ordinal),0)+1 AS ordinal FROM enrichment_collection_attempts WHERE request_id=$1",
        [input.requestId],
      );
      const id = randomUUID(),
        clientKey = randomUUID();
      await tx.query(
        "INSERT INTO enrichment_collection_attempts(id,request_id,ordinal,client_key,budget_id,cap_micros) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          input.requestId,
          ordinal,
          clientKey,
          input.budgetId,
          input.capMicros,
        ],
      );
      return { id, clientKey, requestId: input.requestId };
    });
  }
  async markDispatched(attemptId: string) {
    await one(
      this.db,
      "UPDATE enrichment_collection_attempts SET dispatch_state='dispatching' WHERE id=$1 AND dispatch_state='reserved' RETURNING id",
      [attemptId],
    );
  }
  async markUncertain(attemptId: string, reason: string) {
    await one(
      this.db,
      "UPDATE enrichment_collection_attempts SET dispatch_state='uncertain',reason=$2 WHERE id=$1 AND dispatch_state IN ('reserved','dispatching','uncertain') RETURNING id",
      [attemptId, reason],
    );
  }
  async reconcileNotCharged(
    attemptId: string,
    resolution: { actor: string; evidence: string },
  ) {
    if (!resolution.actor || !resolution.evidence)
      throw new Error("reconciliation evidence required");
    await this.db.transaction(async (tx) => {
      const attempt = await one<{ budget_id: string; cap_micros: string }>(
        tx,
        "UPDATE enrichment_collection_attempts SET dispatch_state='not_charged',payment_state='not_charged',resolution=$2 WHERE id=$1 AND dispatch_state IN ('reserved','dispatching','uncertain') RETURNING budget_id,cap_micros::text",
        [attemptId, json(resolution)],
      );
      await tx.query(
        "UPDATE enrichment_budgets SET committed_micros=committed_micros-$2 WHERE id=$1",
        [attempt.budget_id, attempt.cap_micros],
      );
    });
  }
  async reconcileCapturedPayment(
    attemptId: string,
    input: {
      paymentState: "settled" | "not_charged";
      settledMicros: string;
      actor: string;
      evidence: string;
    },
  ): Promise<void> {
    if (!input.actor || !input.evidence)
      throw new Error("reconciliation evidence required");
    const settled = money(input.settledMicros);
    if (input.paymentState === "not_charged" && settled !== "0")
      throw new Error("not-charged resolution must have zero settled cost");
    await this.db.transaction(async (tx) => {
      const attempt = await one<{
        budget_id: string;
        cap_micros: string;
        settled_micros: string | null;
        payment_state: PaymentState;
      }>(
        tx,
        "SELECT budget_id,cap_micros::text,settled_micros::text,payment_state FROM enrichment_collection_attempts WHERE id=$1 AND dispatch_state='captured' FOR UPDATE",
        [attemptId],
      );
      if (
        attempt.payment_state === "settled" ||
        attempt.payment_state === "not_charged"
      ) {
        if (
          attempt.payment_state !== input.paymentState ||
          attempt.settled_micros !== settled
        )
          throw new Error("conflicting payment resolution");
        return;
      }
      await tx.query(
        "UPDATE enrichment_budgets SET committed_micros=committed_micros-$2+$3 WHERE id=$1",
        [attempt.budget_id, attempt.cap_micros, settled],
      );
      await tx.query(
        "UPDATE enrichment_collection_attempts SET payment_state=$2,settled_micros=$3,resolution=$4,reason=$5 WHERE id=$1",
        [
          attemptId,
          input.paymentState,
          settled,
          json({ actor: input.actor, evidence: input.evidence }),
          BigInt(settled) > BigInt(attempt.cap_micros)
            ? "provider exceeded authorized cap"
            : null,
        ],
      );
    });
  }
  private async insertArtifact(
    tx: Sql,
    input: ArtifactInput,
  ): Promise<Artifact> {
    const id = randomUUID(),
      sha256 = hash(input.body),
      metadata = input.metadata ?? {};
    await tx.query(
      "INSERT INTO enrichment_artifacts(id,kind,attempt_id,run_id,import_batch,sha256,body,byte_length,content_type,redaction_version,metadata,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        id,
        input.kind,
        input.attemptId ?? null,
        input.runId ?? null,
        input.importBatch ?? null,
        sha256,
        Buffer.from(input.body),
        input.body.byteLength,
        input.contentType,
        input.redactionVersion,
        json(metadata),
        input.expiresAt ?? null,
      ],
    );
    return { id, kind: input.kind, body: input.body, sha256, metadata };
  }
  async putArtifact(input: ArtifactInput) {
    return this.insertArtifact(this.db, input);
  }
  async getArtifact(id: string): Promise<Artifact | null> {
    const row = (
      await this.db.query<Artifact>(
        "SELECT id,kind,body,sha256,metadata FROM enrichment_artifacts WHERE id=$1 AND purged_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals WHERE artifact_id=$1)",
        [id],
      )
    ).rows[0];
    if (row && hash(row.body) !== row.sha256)
      throw new Error("artifact checksum mismatch");
    return row ?? null;
  }
  async getReusableArtifact(requestId: string): Promise<Artifact | null> {
    const row = (
      await this.db.query<{ id: string }>(
        "SELECT a.id FROM enrichment_artifacts a JOIN enrichment_collection_attempts t ON t.id=a.attempt_id WHERE t.request_id=$1 AND t.dispatch_state='captured' AND a.kind IN ('source_response','generation_response','tool_response') ORDER BY a.created_at DESC LIMIT 1",
        [requestId],
      )
    ).rows[0];
    return row ? this.getArtifact(row.id) : null;
  }
  async captureResponse(input: {
    attemptId: string;
    body: Uint8Array;
    contentType: string;
    redactionVersion: string;
    paymentState: PaymentState;
    settledMicros?: string;
    metadata?: Record<string, unknown>;
    kind?: ArtifactKind;
  }): Promise<Artifact> {
    return this.db.transaction(async (tx) => {
      const attempt = await one<{ budget_id: string; cap_micros: string }>(
        tx,
        "SELECT budget_id,cap_micros::text FROM enrichment_collection_attempts WHERE id=$1 AND dispatch_state IN ('dispatching','uncertain') FOR UPDATE",
        [input.attemptId],
      );
      const artifact = await this.insertArtifact(tx, {
        ...input,
        kind: input.kind ?? "source_response",
      });
      const validSettlement =
        input.settledMicros !== undefined && /^\d+$/.test(input.settledMicros);
      const settled =
        input.paymentState === "settled" && validSettlement
          ? money(input.settledMicros!)
          : input.paymentState === "not_charged"
            ? "0"
            : null;
      const paymentState =
        input.paymentState === "settled" && !validSettlement
          ? "uncertain"
          : input.paymentState;
      const breach =
        settled !== null && BigInt(settled) > BigInt(attempt.cap_micros);
      await tx.query(
        "UPDATE enrichment_collection_attempts SET dispatch_state='captured',payment_state=$2,settled_micros=$3,reason=$4 WHERE id=$1",
        [
          input.attemptId,
          paymentState,
          settled,
          breach
            ? "provider exceeded authorized cap"
            : paymentState === "uncertain"
              ? "payment requires reconciliation"
              : null,
        ],
      );
      if (settled !== null)
        await tx.query(
          "UPDATE enrichment_budgets SET committed_micros=committed_micros-$2+$3 WHERE id=$1",
          [attempt.budget_id, attempt.cap_micros, settled],
        );
      return artifact;
    });
  }
  async createEntity(
    kind: "founder" | "product",
    legacyKey?: string,
  ): Promise<string> {
    return (
      await one<{ id: string }>(
        this.db,
        "INSERT INTO enrichment_entities(id,kind,legacy_key) VALUES($1,$2,$3) ON CONFLICT(legacy_key) DO UPDATE SET legacy_key=EXCLUDED.legacy_key RETURNING id",
        [randomUUID(), kind, legacyKey ?? null],
      )
    ).id;
  }
  async addEvidence(input: {
    artifactId: string;
    extractorVersion: string;
    locator: string;
    sourceId?: string;
    sourceUrl?: string;
    authorId?: string;
    publishedAt?: string;
    payload: unknown;
    excerpt: string;
  }): Promise<string> {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      await one(
        tx,
        "SELECT id FROM enrichment_artifacts WHERE id=$1 AND purged_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals WHERE artifact_id=$1)",
        [input.artifactId],
      );
      const id = randomUUID();
      await tx.query(
        "INSERT INTO enrichment_evidence(id,artifact_id,extractor_version,locator,source_id,source_url,author_id,published_at,payload,excerpt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(artifact_id,extractor_version,locator) DO NOTHING",
        [
          id,
          input.artifactId,
          input.extractorVersion,
          input.locator,
          input.sourceId ?? null,
          input.sourceUrl ?? null,
          input.authorId ?? null,
          input.publishedAt ?? null,
          json(input.payload),
          input.excerpt,
        ],
      );
      return (
        await one<{ id: string }>(
          tx,
          "SELECT id FROM enrichment_evidence WHERE artifact_id=$1 AND extractor_version=$2 AND locator=$3 AND payload=$4::jsonb AND excerpt=$5 AND source_id IS NOT DISTINCT FROM $6 AND source_url IS NOT DISTINCT FROM $7 AND author_id IS NOT DISTINCT FROM $8 AND published_at IS NOT DISTINCT FROM $9::timestamptz",
          [
            input.artifactId,
            input.extractorVersion,
            input.locator,
            json(input.payload),
            input.excerpt,
            input.sourceId ?? null,
            input.sourceUrl ?? null,
            input.authorId ?? null,
            input.publishedAt ?? null,
          ],
        )
      ).id;
    });
  }
  async linkEvidence(entityId: string, evidenceId: string, relation: string) {
    await this.db.query(
      "INSERT INTO enrichment_entity_evidence VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [entityId, evidenceId, relation],
    );
  }
  async recordOrigin(
    founderId: string,
    evidenceId: string | null,
    status: "confirmed" | "legacy-unverified" | "unknown",
  ) {
    await this.db.query(
      "INSERT INTO enrichment_index_origins(founder_id,evidence_id,status) SELECT id,$2,$3 FROM enrichment_entities WHERE id=$1 AND kind='founder' ON CONFLICT DO NOTHING",
      [founderId, evidenceId, status],
    );
  }
  async linkProduct(founderId: string, productId: string, evidenceId: string) {
    await this.db.transaction(async (tx) => {
      await one(
        tx,
        "SELECT f.id FROM enrichment_entities f,enrichment_entities p WHERE f.id=$1 AND f.kind='founder' AND p.id=$2 AND p.kind='product'",
        [founderId, productId],
      );
      await tx.query(
        "INSERT INTO enrichment_founder_products VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [founderId, productId, evidenceId],
      );
    });
  }
  async createRelease(manifest: {
    stages: string[];
    [key: string]: unknown;
  }): Promise<string> {
    if (
      !manifest.stages.length ||
      new Set(manifest.stages).size !== manifest.stages.length
    )
      throw new Error("unique required stages needed");
    const standard: Record<string, string[]> = {
      collection: [],
      extraction: ["collection"],
      product_discovery: ["extraction"],
      product_descriptions: ["product_discovery"],
      founder_dna: ["extraction"],
      embeddings: ["founder_dna", "product_descriptions"],
    };
    const dependencies =
      manifest.dependencies ??
      Object.fromEntries(
        manifest.stages.map((stage, index) => [
          stage,
          (standard[stage] ?? manifest.stages.slice(0, index)).filter(
            (dependency) => manifest.stages.includes(dependency),
          ),
        ]),
      );
    if (
      typeof dependencies !== "object" ||
      dependencies === null ||
      Array.isArray(dependencies)
    )
      throw new Error("invalid stage dependencies");
    const dependencyMap = dependencies as Record<string, unknown>;
    for (const stage of manifest.stages) {
      const required = dependencyMap[stage];
      if (
        !Array.isArray(required) ||
        required.some(
          (dependency) =>
            typeof dependency !== "string" ||
            dependency === stage ||
            !manifest.stages.includes(dependency),
        )
      )
        throw new Error("invalid stage dependencies");
    }
    const visited = new Set<string>(),
      visiting = new Set<string>();
    const visit = (stage: string) => {
      if (visiting.has(stage)) throw new Error("cyclic stage dependencies");
      if (visited.has(stage)) return;
      visiting.add(stage);
      for (const dependency of dependencyMap[stage] as string[])
        visit(dependency);
      visiting.delete(stage);
      visited.add(stage);
    };
    for (const stage of manifest.stages) visit(stage);
    const id = randomUUID();
    await this.db.query(
      "INSERT INTO enrichment_releases(id,manifest) VALUES($1,$2)",
      [id, json({ ...manifest, dependencies })],
    );
    return id;
  }
  async approveRelease(
    id: string,
    evaluationArtifactId: string,
    approval: { actor: string; reason: string },
  ) {
    if (!approval.actor || !approval.reason)
      throw new Error("approval required");
    await one(
      this.db,
      "UPDATE enrichment_releases SET status='approved',evaluation_artifact_id=$2,approval=$3 WHERE id=$1 AND status='proposed' RETURNING id",
      [id, evaluationArtifactId, json(approval)],
    );
  }
  async promoteRelease(
    scope: string,
    releaseId: string,
    reason: string,
  ): Promise<number> {
    if (!reason) throw new Error("promotion reason required");
    return this.db.transaction(async (tx) => {
      await one(
        tx,
        "SELECT id FROM enrichment_releases WHERE id=$1 AND status='approved' FOR SHARE",
        [releaseId],
      );
      const row = await one<{ revision: string }>(
        tx,
        "INSERT INTO enrichment_intake(scope,release_id) VALUES($1,$2) ON CONFLICT(scope) DO UPDATE SET release_id=EXCLUDED.release_id,revision=enrichment_intake.revision+1,catchup_pending=true RETURNING revision",
        [scope, releaseId],
      );
      await tx.query(
        "INSERT INTO enrichment_promotion_events(id,scope,release_id,revision,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), scope, releaseId, row.revision, reason],
      );
      return Number(row.revision);
    });
  }
  async intake(scope: string, entityId: string) {
    await this.db.transaction(async (tx) => {
      const state = await one<{ release_id: string; revision: string }>(
        tx,
        "SELECT release_id,revision FROM enrichment_intake WHERE scope=$1 FOR SHARE",
        [scope],
      );
      await tx.query(
        "INSERT INTO enrichment_targets(entity_id,scope,release_id,revision) SELECT id,$2,$3,$4 FROM enrichment_entities WHERE id=$1 AND kind='founder' AND status='active' ON CONFLICT(entity_id) DO NOTHING",
        [entityId, scope, state.release_id, state.revision],
      );
    });
  }
  async reconcileTargets(scope: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const state = await one<{ release_id: string; revision: string }>(
        tx,
        "SELECT release_id,revision FROM enrichment_intake WHERE scope=$1 FOR UPDATE",
        [scope],
      );
      await tx.query(
        "UPDATE enrichment_targets SET release_id=$2,revision=$3 WHERE scope=$1 AND revision<$3",
        [scope, state.release_id, state.revision],
      );
      await tx.query(
        "INSERT INTO enrichment_stage_work(id,entity_id,release_id,generation,stage) SELECT gen_random_uuid(),t.entity_id,t.release_id,t.generation,s.stage FROM enrichment_targets t JOIN enrichment_entities e ON e.id=t.entity_id JOIN enrichment_releases r ON r.id=t.release_id CROSS JOIN LATERAL jsonb_array_elements_text(r.manifest->'stages') s(stage) WHERE t.scope=$1 AND e.status='active' AND e.kind='founder' ON CONFLICT DO NOTHING",
        [scope],
      );
      await tx.query(
        "UPDATE enrichment_intake SET catchup_pending=false WHERE scope=$1",
        [scope],
      );
    });
  }
  async createCampaign(input: {
    scope: string;
    releaseId: string;
    entityIds: string[];
    mode: "rederive" | "acquire";
    budgetId?: string;
  }): Promise<string> {
    const members = [...new Set(input.entityIds)].sort(),
      id = randomUUID();
    await this.db.transaction(async (tx) => {
      const manifest = await this.insertArtifact(tx, {
        kind: "manifest",
        body: Buffer.from(json(members)),
        contentType: "application/json",
        redactionVersion: "none",
        runId: id,
      });
      await tx.query(
        "INSERT INTO enrichment_campaigns(id,scope,release_id,manifest_artifact_id,mode,budget_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          input.scope,
          input.releaseId,
          manifest.id,
          input.mode,
          input.budgetId ?? null,
        ],
      );
      await tx.query(
        "INSERT INTO enrichment_campaign_members(campaign_id,entity_id) SELECT $1,unnest($2::uuid[])",
        [id, members],
      );
    });
    return id;
  }
  async claimStage(
    workerLeaseSeconds = 60,
    scope?: string,
  ): Promise<{
    id: string;
    leaseToken: string;
    entityId: string;
    releaseId: string;
    generation: number;
    stage: string;
  } | null> {
    if (workerLeaseSeconds < 1 || workerLeaseSeconds > 3600)
      throw new Error("invalid lease duration");
    return this.db.transaction(async (tx) => {
      // Each release owns its dependency graph; older custom releases retain ordered semantics.
      const row = (
        await tx.query<{
          id: string;
          entityId: string;
          releaseId: string;
          generation: number;
          stage: string;
        }>(
          `SELECT w.id,w.entity_id AS "entityId",w.release_id AS "releaseId",w.generation,w.stage
        FROM enrichment_stage_work w JOIN enrichment_entities e ON e.id=w.entity_id
        JOIN enrichment_targets t ON t.entity_id=w.entity_id AND t.release_id=w.release_id AND t.generation=w.generation
        JOIN enrichment_intake i ON i.scope=t.scope AND i.revision=t.revision
        JOIN enrichment_releases r ON r.id=w.release_id
        CROSS JOIN LATERAL jsonb_array_elements_text(r.manifest->'stages') WITH ORDINALITY current_stage(stage,position)
        WHERE ($1::text IS NULL OR t.scope=$1) AND w.status='pending' AND e.status='active' AND r.status='approved' AND current_stage.stage=w.stage AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(coalesce(r.manifest->'dependencies'->w.stage,
            (SELECT coalesce(jsonb_agg(prior.stage),'[]'::jsonb) FROM jsonb_array_elements_text(r.manifest->'stages') WITH ORDINALITY prior(stage,position) WHERE prior.position<current_stage.position))) dependency(stage)
          WHERE NOT EXISTS (
            SELECT 1 FROM enrichment_stage_work done WHERE done.entity_id=w.entity_id AND done.release_id=w.release_id
            AND done.generation=w.generation AND done.stage=dependency.stage AND done.status IN ('succeeded','not_applicable')))
        ORDER BY w.id FOR UPDATE OF w SKIP LOCKED LIMIT 1`,
          [scope ?? null],
        )
      ).rows[0];
      if (!row) return null;
      const leaseToken = randomUUID();
      await tx.query(
        "UPDATE enrichment_stage_work SET status='running',lease_token=$2,lease_until=now()+($3 * interval '1 second'),attempts=attempts+1 WHERE id=$1",
        [row.id, leaseToken, workerLeaseSeconds],
      );
      return { ...row, leaseToken };
    });
  }
  async finishStage(input: {
    id: string;
    leaseToken: string;
    status: StageStatus;
    reason?: string;
    evidenceId?: string;
    outputId?: string;
  }) {
    if (["pending", "running"].includes(input.status))
      throw new Error("terminal outcome required");
    await one(
      this.db,
      `UPDATE enrichment_stage_work w SET status=$3,reason=$4,evidence_id=$5,output_id=$6,lease_token=NULL,lease_until=NULL
       WHERE w.id=$1 AND lease_token=$2 AND status='running' AND lease_until>now()
       AND ($3 <> 'not_applicable' OR EXISTS(SELECT 1 FROM enrichment_entity_evidence link JOIN enrichment_evidence e ON e.id=link.evidence_id JOIN enrichment_artifacts a ON a.id=e.artifact_id
         WHERE link.entity_id=w.entity_id AND e.id=$5 AND a.purged_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals x WHERE x.artifact_id=a.id)))
       RETURNING w.id`,
      [
        input.id,
        input.leaseToken,
        input.status,
        input.reason ?? null,
        input.evidenceId ?? null,
        input.outputId ?? null,
      ],
    );
  }
  async assertStageLease(
    id: string,
    leaseToken: string,
    minimumRemainingSeconds = 30,
  ): Promise<void> {
    if (
      !Number.isFinite(minimumRemainingSeconds) ||
      minimumRemainingSeconds < 0 ||
      minimumRemainingSeconds > 3600
    )
      throw new Error("invalid minimum lease duration");
    await one(
      this.db,
      `SELECT w.id FROM enrichment_stage_work w
      JOIN enrichment_targets t ON t.entity_id=w.entity_id AND t.release_id=w.release_id AND t.generation=w.generation
      JOIN enrichment_entities e ON e.id=w.entity_id AND e.status='active'
      JOIN enrichment_intake i ON i.scope=t.scope AND i.revision=t.revision AND i.release_id=t.release_id
      JOIN enrichment_releases r ON r.id=t.release_id AND r.status='approved'
      WHERE w.id=$1 AND w.lease_token=$2 AND w.status='running' AND w.lease_until>now()+($3*interval '1 second')`,
      [id, leaseToken, minimumRemainingSeconds],
    );
  }
  async saveAnalysis(input: AnalysisInput): Promise<string> {
    const id = input.id ?? randomUUID(),
      values = [
        id,
        input.entityId,
        input.releaseId,
        input.generation,
        input.purpose,
        input.inputArtifactId,
        input.inputDigest,
        input.recipeDigest,
        json(input.evidenceIds),
        json(input.output),
        json(input.validationReport),
        input.status,
      ];
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      await tx.query(
        "INSERT INTO enrichment_analysis_runs(id,entity_id,release_id,generation,purpose,input_artifact_id,input_digest,recipe_digest,evidence_ids,output,validation_report,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO NOTHING",
        values,
      );
      await one(
        tx,
        "SELECT id FROM enrichment_analysis_runs WHERE id=$1 AND entity_id=$2 AND release_id=$3 AND generation=$4 AND purpose=$5 AND input_artifact_id=$6 AND input_digest=$7 AND recipe_digest=$8 AND evidence_ids=$9::jsonb AND output IS NOT DISTINCT FROM $10::jsonb AND validation_report=$11::jsonb AND status=$12",
        values,
      );
      const retained = await tx.query(
        "SELECT id FROM enrichment_eligible_analyses WHERE id=$1",
        [id],
      );
      // A response can arrive after evidence withdrawal. Keep no late derived payload.
      if (!retained.rows.length)
        await this.purgeWithin(
          tx,
          input.inputArtifactId,
          "system",
          "input withdrawn before analysis completion",
        );
    });
    return id;
  }
  async assertAnalysisInputs(input: {
    entityId: string;
    releaseId: string;
    generation: number;
    purpose: string;
    recipeDigest: string;
    subjectName?: string;
    evidence: EvidenceInput[];
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      await one(
        tx,
        `SELECT t.entity_id FROM enrichment_targets t
        JOIN enrichment_entities e ON e.id=t.entity_id AND e.status='active'
        JOIN enrichment_intake i ON i.scope=t.scope AND i.revision=t.revision AND i.release_id=t.release_id
        JOIN enrichment_releases r ON r.id=t.release_id AND r.status='approved'
        WHERE t.entity_id=$1 AND t.release_id=$2 AND t.generation=$3 AND r.manifest->'recipes'->>$4=$5
        AND ($6::text IS NULL OR (e.kind='product' AND e.legacy_key ~ '^product:[0-9a-f-]{36}:' AND substring(e.legacy_key FROM 46)=lower(trim($6))))`,
        [
          input.entityId,
          input.releaseId,
          input.generation,
          input.purpose,
          input.recipeDigest,
          input.subjectName ?? null,
        ],
      );
      for (const evidence of input.evidence) {
        if (hash(json(evidence.text)) !== evidence.contentHash)
          throw new Error("evidence text digest mismatch");
        const saved = await one<{ metadata: Record<string, unknown> }>(
          tx,
          `SELECT a.metadata FROM enrichment_evidence e
          JOIN enrichment_entity_evidence link ON link.evidence_id=e.id AND link.entity_id=$3
          JOIN enrichment_artifacts a ON a.id=e.artifact_id AND a.purged_at IS NULL
          WHERE e.id=$1 AND e.artifact_id=$2 AND e.excerpt=$4 AND e.source_url IS NOT DISTINCT FROM $5 AND e.extractor_version=$6 AND (a.expires_at IS NULL OR a.expires_at>now())
          AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals x WHERE x.artifact_id=a.id)`,
          [
            evidence.id,
            evidence.artifactId,
            input.entityId,
            evidence.text,
            evidence.sourceUrl,
            evidence.extractorVersion,
          ],
        );
        if (
          evidence.provenance !== undefined &&
          stableDigest(evidence.provenance) !==
            stableDigest(evidenceProvenance(saved.metadata))
        )
          throw new Error("evidence_provenance_mismatch");
      }
    });
  }
  async findSuccessfulAnalysis(input: {
    entityId: string;
    purpose: string;
    inputDigest: string;
    recipeDigest: string;
  }): Promise<{
    id: string;
    output: unknown;
    inputArtifactId: string;
    releaseId: string;
    generation: number;
  } | null> {
    return (
      (
        await this.db.query<{
          id: string;
          output: unknown;
          inputArtifactId: string;
          releaseId: string;
          generation: number;
        }>(
          `SELECT a.id,a.output,a.input_artifact_id AS "inputArtifactId",a.release_id AS "releaseId",a.generation FROM enrichment_eligible_analyses a WHERE a.entity_id=$1 AND a.purpose=$2 AND a.input_digest=$3 AND a.recipe_digest=$4 AND a.status='succeeded' ORDER BY a.created_at DESC LIMIT 1`,
          [
            input.entityId,
            input.purpose,
            input.inputDigest,
            input.recipeDigest,
          ],
        )
      ).rows[0] ?? null
    );
  }
  async findAnalysis(id: string): Promise<{
    id: string;
    output: unknown;
    inputArtifactId: string;
    releaseId: string;
    generation: number;
    status: AnalysisInput["status"];
    validationReport: unknown;
  } | null> {
    return (
      (
        await this.db.query<{
          id: string;
          output: unknown;
          inputArtifactId: string;
          releaseId: string;
          generation: number;
          status: AnalysisInput["status"];
          validationReport: unknown;
        }>(
          `SELECT id,output,input_artifact_id AS "inputArtifactId",release_id AS "releaseId",generation,status,validation_report AS "validationReport" FROM enrichment_analysis_runs WHERE id=$1 AND purged_at IS NULL`,
          [id],
        )
      ).rows[0] ?? null
    );
  }
  async recoverExpiredLeases(): Promise<void> {
    await this.db.query(
      "UPDATE enrichment_stage_work SET status='blocked',reason='expired lease requires attempt reconciliation',lease_token=NULL WHERE status='running' AND lease_until<=now()",
    );
  }
  async withdrawArtifact(
    artifactId: string,
    actor: string,
    reason: string,
  ): Promise<void> {
    if (!actor || !reason)
      throw new Error("withdrawal actor and reason required");
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      await this.purgeWithin(tx, artifactId, actor, reason);
    });
  }
  private async purgeWithin(
    tx: Sql,
    artifactId: string,
    actor: string,
    reason: string,
  ): Promise<void> {
    const runs = (
      await tx.query<{
        id: string;
        input_artifact_id: string;
        validation_report: Record<string, unknown>;
      }>(
        `WITH RECURSIVE affected AS (
      SELECT a.id FROM enrichment_analysis_runs a WHERE a.input_artifact_id=$1 OR EXISTS(
        SELECT 1 FROM enrichment_evidence e WHERE e.artifact_id=$1 AND a.evidence_ids ? e.id::text)
      UNION SELECT child.id FROM enrichment_analysis_runs child JOIN affected parent ON child.validation_report->>'reusedFromRunId'=parent.id::text)
      SELECT a.id,a.input_artifact_id,a.validation_report FROM enrichment_analysis_runs a JOIN affected USING(id)`,
        [artifactId],
      )
    ).rows;
    const runIds = runs.map((r) => r.id),
      inputIds = runs.map((r) => r.input_artifact_id);
    const attempts = runs.flatMap((r) =>
      typeof r.validation_report.attemptId === "string"
        ? [r.validation_report.attemptId]
        : [],
    );
    const vectors = (
      await tx.query<{ embedding_id: string }>(
        "SELECT DISTINCT embedding_id FROM enrichment_analysis_embeddings WHERE analysis_id=ANY($1::uuid[])",
        [runIds],
      )
    ).rows.map((r) => r.embedding_id);
    await tx.query(
      "DELETE FROM enrichment_profiles WHERE analysis_id=ANY($1::uuid[])",
      [runIds],
    );
    await tx.query(
      "DELETE FROM enrichment_analysis_embeddings WHERE analysis_id=ANY($1::uuid[])",
      [runIds],
    );
    const vectorAttempts = (
      await tx.query<{ attempt_id: string | null }>(
        "DELETE FROM enrichment_embeddings v WHERE id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM enrichment_analysis_embeddings link WHERE link.embedding_id=v.id) RETURNING attempt_id",
        [vectors],
      )
    ).rows.flatMap((r) => (r.attempt_id ? [r.attempt_id] : []));
    const artifacts = (
      await tx.query<{ id: string; attempt_id: string | null }>(
        "SELECT id,attempt_id FROM enrichment_artifacts WHERE id=$1 OR id=ANY($2::uuid[]) OR run_id=ANY($3::uuid[]) OR attempt_id::text=ANY($4::text[]) OR attempt_id=(SELECT attempt_id FROM enrichment_artifacts WHERE id=$1)",
        [artifactId, inputIds, runIds, [...attempts, ...vectorAttempts]],
      )
    ).rows;
    const artifactIds = artifacts.map((a) => a.id),
      requestAttempts = artifacts.flatMap((a) =>
        a.attempt_id ? [a.attempt_id] : [],
      );
    await tx.query(
      "INSERT INTO enrichment_artifact_withdrawals(artifact_id,actor,reason) SELECT unnest($1::uuid[]),$2,$3 ON CONFLICT DO NOTHING",
      [artifactIds, actor, reason],
    );
    await tx.query(
      "UPDATE enrichment_artifacts SET body='\\x'::bytea,byte_length=0,metadata='{}'::jsonb,purged_at=now() WHERE id=ANY($1::uuid[]) AND purged_at IS NULL",
      [artifactIds],
    );
    await tx.query(
      "UPDATE enrichment_evidence SET payload='{}'::jsonb,excerpt='',source_id=NULL,source_url=NULL,author_id=NULL,published_at=NULL,purged_at=now() WHERE artifact_id=ANY($1::uuid[]) AND purged_at IS NULL",
      [artifactIds],
    );
    await tx.query(
      "UPDATE enrichment_analysis_runs SET output=NULL,validation_report='{}'::jsonb,purged_at=now() WHERE id=ANY($1::uuid[]) AND purged_at IS NULL",
      [runIds],
    );
    await tx.query(
      `UPDATE enrichment_stage_work SET status='blocked',reason='supporting source withdrawn',lease_token=NULL,lease_until=NULL
      WHERE status IN ('succeeded','not_applicable','running') AND entity_id IN (
        SELECT entity_id FROM enrichment_analysis_runs WHERE id=ANY($1::uuid[])
        UNION SELECT link.entity_id FROM enrichment_entity_evidence link JOIN enrichment_evidence e ON e.id=link.evidence_id WHERE e.artifact_id=ANY($2::uuid[]))`,
      [runIds, artifactIds],
    );
    await tx.query(
      "UPDATE enrichment_collection_requests SET args='{}'::jsonb WHERE id IN (SELECT request_id FROM enrichment_collection_attempts WHERE id=ANY($1::uuid[]))",
      [requestAttempts],
    );
    await tx.query(
      "UPDATE enrichment_collection_attempts SET resolution=NULL,reason='source data withdrawn' WHERE id=ANY($1::uuid[])",
      [requestAttempts],
    );
    const queue = await tx.query<{ exists: boolean }>(
      "SELECT to_regclass('enrichment_founder_intake') IS NOT NULL AS exists",
    );
    if (queue.rows[0].exists)
      await tx.query(
        "UPDATE enrichment_founder_intake SET snapshot='{}'::jsonb WHERE founder_key IN (SELECT owner.legacy_key FROM enrichment_entities owner JOIN enrichment_entity_evidence link ON link.entity_id=owner.id JOIN enrichment_evidence e ON e.id=link.evidence_id WHERE e.artifact_id=ANY($1::uuid[]))",
        [artifactIds],
      );
  }
  async publishAnalysis(
    analysisId: string,
    fields: { category?: string; tags?: string[] } = {},
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      const run = (
        await tx.query<{
          entity_id: string;
          release_id: string;
          generation: number;
        }>(
          "SELECT entity_id,release_id,generation FROM enrichment_eligible_analyses WHERE id=$1 AND status='succeeded'",
          [analysisId],
        )
      ).rows[0];
      if (!run) return false;
      // Match reconciliation's intake-before-target lock order.
      await tx.query(
        "SELECT i.scope FROM enrichment_intake i JOIN enrichment_targets t ON t.scope=i.scope WHERE t.entity_id=$1 FOR SHARE OF i",
        [run.entity_id],
      );
      const target = (
        await tx.query(
          "SELECT t.entity_id FROM enrichment_targets t JOIN enrichment_entities e ON e.id=t.entity_id JOIN enrichment_releases r ON r.id=t.release_id JOIN enrichment_intake i ON i.scope=t.scope AND i.release_id=t.release_id AND i.revision=t.revision WHERE t.entity_id=$1 AND t.release_id=$2 AND t.generation=$3 AND e.status='active' AND r.status='approved' FOR UPDATE OF t,e FOR SHARE OF i,r",
          [run.entity_id, run.release_id, run.generation],
        )
      ).rows[0];
      if (!target) return false;
      const previous = (
        await tx.query<{ analysis_id: string }>(
          "SELECT analysis_id FROM enrichment_profiles WHERE entity_id=$1",
          [run.entity_id],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO enrichment_profiles(entity_id,analysis_id,category,tags) VALUES($1,$2,$3,$4) ON CONFLICT(entity_id) DO UPDATE SET analysis_id=EXCLUDED.analysis_id,category=EXCLUDED.category,tags=EXCLUDED.tags,updated_at=now()",
        [run.entity_id, analysisId, fields.category ?? null, fields.tags ?? []],
      );
      await tx.query(
        "INSERT INTO enrichment_publication_events(id,entity_id,prior_analysis_id,analysis_id,reason) VALUES($1,$2,$3,$4,'validated publication')",
        [
          randomUUID(),
          run.entity_id,
          previous?.analysis_id ?? null,
          analysisId,
        ],
      );
      return true;
    });
  }
  async suppressEntity(entityId: string, reason: string) {
    if (!reason) throw new Error("reason required");
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      await one(
        tx,
        "UPDATE enrichment_entities SET status='suppressed' WHERE id=$1 RETURNING id",
        [entityId],
      );
      await tx.query("DELETE FROM enrichment_profiles WHERE entity_id=$1", [
        entityId,
      ]);
      await tx.query(
        "DELETE FROM enrichment_analysis_embeddings WHERE entity_id=$1",
        [entityId],
      );
      await tx.query(
        "UPDATE enrichment_stage_work SET status='cancelled',reason=$2,lease_token=NULL WHERE entity_id=$1 AND status IN ('pending','running')",
        [entityId, reason],
      );
      await tx.query(
        "INSERT INTO enrichment_publication_events(id,entity_id,reason) VALUES($1,$2,$3)",
        [randomUUID(), entityId, reason],
      );
      const queue = await tx.query<{ exists: boolean }>(
        "SELECT to_regclass('enrichment_founder_intake') IS NOT NULL AS exists",
      );
      if (queue.rows[0].exists)
        await tx.query(
          "UPDATE enrichment_founder_intake SET snapshot='{}'::jsonb WHERE founder_key=(SELECT legacy_key FROM enrichment_entities WHERE id=$1)",
          [entityId],
        );
    });
  }
  async saveEmbedding(input: {
    scope: string;
    text: string;
    templateVersion: string;
    model: string;
    modelVersion: string;
    distance: "cosine" | "euclidean" | "dot";
    vector: number[];
    attemptId?: string;
  }): Promise<string> {
    if (!input.vector.length || input.vector.some((v) => !Number.isFinite(v)))
      throw new Error("finite nonempty vector required");
    return (
      await one<{ id: string }>(
        this.db,
        "INSERT INTO enrichment_embeddings(id,scope,input_text,input_hash,template_version,model,dimensions,vector,attempt_id,model_version,distance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(scope,input_hash,template_version,model,model_version,distance,dimensions) DO UPDATE SET input_hash=EXCLUDED.input_hash RETURNING id",
        [
          randomUUID(),
          input.scope,
          input.text,
          hash(input.text),
          input.templateVersion,
          input.model,
          input.vector.length,
          input.vector,
          input.attemptId ?? null,
          input.modelVersion,
          input.distance,
        ],
      )
    ).id;
  }
  async linkEmbedding(
    entityId: string,
    analysisId: string,
    embeddingId: string,
    purpose: string,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      await one(
        tx,
        "SELECT id FROM enrichment_eligible_analyses WHERE id=$1 AND entity_id=$2 AND status='succeeded'",
        [analysisId, entityId],
      );
      await tx.query(
        "INSERT INTO enrichment_analysis_embeddings VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [entityId, analysisId, embeddingId, purpose],
      );
    });
  }
}
