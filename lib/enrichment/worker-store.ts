// Layer: persistence. Owns worker reads and atomic child-target alignment.
import { createHash } from "node:crypto";
import type { Database } from "./db";
import {
  evidenceProvenance,
  stableDigest,
  stableUuid,
  type EvidenceInput,
} from "./contracts";
import type { ClaimedStage } from "./pipeline";

export class WorkerStore {
  constructor(readonly db: Database) {}

  async assertConfiguration(
    work: ClaimedStage,
    configuration: unknown,
  ): Promise<void> {
    const row = (
      await this.db.query<{ worker: unknown }>(
        `SELECT r.manifest->'worker' AS worker FROM enrichment_targets t
      JOIN enrichment_entities e ON e.id=t.entity_id AND e.status='active'
      JOIN enrichment_intake i ON i.scope=t.scope AND i.revision=t.revision AND i.release_id=t.release_id
      JOIN enrichment_releases r ON r.id=t.release_id AND r.status='approved'
      WHERE t.entity_id=$1 AND t.release_id=$2 AND t.generation=$3`,
        [work.entityId, work.releaseId, work.generation],
      )
    ).rows[0];
    if (
      !row ||
      !row.worker ||
      stableDigest(row.worker) !== stableDigest(configuration)
    )
      throw new Error("release_worker_configuration_mismatch");
  }

  async entity(entityId: string) {
    const row = (
      await this.db.query<{
        id: string;
        legacyKey: string | null;
        kind: string;
      }>(
        `SELECT id,legacy_key AS "legacyKey",kind FROM enrichment_entities WHERE id=$1 AND status='active'`,
        [entityId],
      )
    ).rows[0];
    if (!row) throw new Error("entity_unavailable");
    return row;
  }

  async stageOutput(
    work: ClaimedStage,
    stage: string,
    anyRelease = false,
  ): Promise<string | null> {
    return (
      (
        await this.db.query<{ output_id: string }>(
          `SELECT w.output_id FROM enrichment_stage_work w
      WHERE w.entity_id=$1 AND w.generation=$2 AND w.stage=$3 AND w.status='succeeded' AND w.output_id IS NOT NULL
      AND ($4::boolean OR w.release_id=$5) ORDER BY w.id LIMIT 1`,
          [work.entityId, work.generation, stage, anyRelease, work.releaseId],
        )
      ).rows[0]?.output_id ?? null
    );
  }

  async evidence(
    entityId: string,
    artifactId?: string,
    evidenceIds?: string[],
  ): Promise<EvidenceInput[]> {
    const rows = (
      await this.db.query<
        Omit<EvidenceInput, "contentHash"> & {
          metadata: Record<string, unknown>;
        }
      >(
        `SELECT DISTINCT e.id,e.artifact_id AS "artifactId",e.excerpt AS text,e.source_url AS "sourceUrl",e.extractor_version AS "extractorVersion",a.metadata
      FROM enrichment_entity_evidence link JOIN enrichment_evidence e ON e.id=link.evidence_id
      JOIN enrichment_artifacts a ON a.id=e.artifact_id AND a.purged_at IS NULL
      WHERE link.entity_id=$1 AND ($2::uuid IS NULL OR e.artifact_id=$2) AND (a.expires_at IS NULL OR a.expires_at>now())
      AND ($3::uuid[] IS NULL OR e.id=ANY($3::uuid[]))
      AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals x WHERE x.artifact_id=a.id) ORDER BY e.id`,
        [entityId, artifactId ?? null, evidenceIds ?? null],
      )
    ).rows;
    return rows.map(({ metadata, ...row }) => ({
      ...row,
      contentHash: stableDigest(row.text),
      provenance: evidenceProvenance(metadata),
    }));
  }

  /** Select only the current extraction manifest, never old linked generations. */
  async evidenceByIds(
    entityId: string,
    ids: string[],
  ): Promise<EvidenceInput[]> {
    if (!ids.length) return [];
    return this.evidence(entityId, undefined, ids);
  }

  async analysis(
    work: Pick<ClaimedStage, "entityId" | "releaseId" | "generation">,
    purpose: string,
  ) {
    return (
      (
        await this.db.query<{ id: string; output: unknown }>(
          `SELECT id,output FROM enrichment_eligible_analyses WHERE entity_id=$1 AND release_id=$2 AND generation=$3 AND purpose=$4 AND status='succeeded' ORDER BY created_at DESC LIMIT 1`,
          [work.entityId, work.releaseId, work.generation, purpose],
        )
      ).rows[0] ?? null
    );
  }

  async ensureProduct(
    work: ClaimedStage,
    name: string,
    evidenceIds: string[],
  ): Promise<string> {
    const id = stableUuid({
      founderId: work.entityId,
      productName: name.trim().toLowerCase(),
    });
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      const parent = (
        await tx.query<{ scope: string; revision: string }>(
          `SELECT t.scope,t.revision FROM enrichment_targets t JOIN enrichment_entities e ON e.id=t.entity_id AND e.status='active'
        JOIN enrichment_intake i ON i.scope=t.scope AND i.revision=t.revision AND i.release_id=t.release_id
        WHERE t.entity_id=$1 AND t.release_id=$2 AND t.generation=$3 FOR UPDATE OF t`,
          [work.entityId, work.releaseId, work.generation],
        )
      ).rows[0];
      if (!parent) throw new Error("stale_parent_target");
      await tx.query(
        "INSERT INTO enrichment_entities(id,kind,legacy_key) VALUES($1,'product',$2) ON CONFLICT(id) DO NOTHING",
        [id, `product:${work.entityId}:${name.trim().toLowerCase()}`],
      );
      const product = (
        await tx.query(
          "SELECT id FROM enrichment_entities WHERE id=$1 AND kind='product' AND status='active' FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!product) throw new Error("product_unavailable");
      const conflict = (
        await tx.query(
          `SELECT p.founder_id FROM enrichment_founder_products p JOIN enrichment_targets t ON t.entity_id=p.founder_id WHERE p.product_id=$1 AND p.founder_id<>$2 AND (t.release_id<>$3 OR t.generation<>$4 OR t.scope<>$5) LIMIT 1`,
          [id, work.entityId, work.releaseId, work.generation, parent.scope],
        )
      ).rows[0];
      if (conflict) throw new Error("shared_product_target_conflict");
      await tx.query(
        `INSERT INTO enrichment_targets(entity_id,scope,release_id,revision,generation) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(entity_id) DO UPDATE SET release_id=EXCLUDED.release_id,revision=EXCLUDED.revision,generation=EXCLUDED.generation
        WHERE enrichment_targets.scope=EXCLUDED.scope AND enrichment_targets.revision<=EXCLUDED.revision AND enrichment_targets.generation<=EXCLUDED.generation`,
        [id, parent.scope, work.releaseId, parent.revision, work.generation],
      );
      for (const evidenceId of evidenceIds) {
        const allowed = (
          await tx.query(
            `SELECT e.id FROM enrichment_evidence e JOIN enrichment_entity_evidence l ON l.evidence_id=e.id AND l.entity_id=$2 JOIN enrichment_artifacts a ON a.id=e.artifact_id AND a.purged_at IS NULL WHERE e.id=$1 AND (a.expires_at IS NULL OR a.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals x WHERE x.artifact_id=a.id)`,
            [evidenceId, work.entityId],
          )
        ).rows[0];
        if (!allowed) throw new Error("unrelated_product_evidence");
        await tx.query(
          "INSERT INTO enrichment_entity_evidence VALUES($1,$2,'product_claim') ON CONFLICT DO NOTHING",
          [id, evidenceId],
        );
        await tx.query(
          "INSERT INTO enrichment_founder_products VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [work.entityId, id, evidenceId],
        );
      }
    });
    return id;
  }

  async embedding(
    scope: string,
    text: string,
    configuration: { model: string; modelVersion: string; dimensions: number },
    templateVersion: string,
  ): Promise<string | null> {
    const hash = createHash("sha256").update(text).digest("hex");
    return (
      (
        await this.db.query<{ id: string }>(
          "SELECT id FROM enrichment_embeddings WHERE scope=$1 AND input_hash=$2 AND input_text=$3 AND model=$4 AND model_version=$5 AND dimensions=$6 AND template_version=$7 AND distance='cosine'",
          [
            scope,
            hash,
            text,
            configuration.model,
            configuration.modelVersion,
            configuration.dimensions,
            templateVersion,
          ],
        )
      ).rows[0]?.id ?? null
    );
  }

  async scope(entityId: string): Promise<string> {
    const row = (
      await this.db.query<{ scope: string }>(
        "SELECT scope FROM enrichment_targets WHERE entity_id=$1",
        [entityId],
      )
    ).rows[0];
    if (!row) throw new Error("target_missing");
    return row.scope;
  }
}
