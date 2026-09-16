import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  migrateEnrichment,
  type Database,
  type Sql,
} from "../lib/enrichment/db";
import { EnrichmentStore } from "../lib/enrichment/store";

async function fixture() {
  const pg = new PGlite();
  const adapt = (client: Pick<PGlite, "query" | "exec">): Sql => ({
    async query<T>(sql: string, values?: unknown[]) {
      if (!values && sql.includes(";")) {
        await client.exec(sql);
        return { rows: [] as T[] };
      }
      return client.query<T>(sql, values);
    },
  });
  const db: Database = {
    ...adapt(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapt(tx))),
  };
  await migrateEnrichment(db);
  await migrateEnrichment(db);
  return { pg, db, store: new EnrichmentStore(db) };
}
test("database export restores exact source bytes and lineage in a fresh engine", async () => {
  const { pg, store } = await fixture();
  const body = Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256));
  const artifact = await store.putArtifact({
    kind: "legacy_import",
    body,
    contentType: "application/octet-stream",
    redactionVersion: "none",
    importBatch: "synthetic-restore",
  });
  const evidence = await store.addEvidence({
    artifactId: artifact.id,
    extractorVersion: "v1",
    locator: "bytes",
    payload: { length: body.length },
    excerpt: "synthetic bytes",
  });
  const backup = await pg.dumpDataDir();
  await pg.close();
  const restored = new PGlite({ loadDataDir: backup });
  try {
    const row = (
      await restored.query<{
        body: Uint8Array;
        sha256: string;
        artifact_id: string;
      }>(
        "SELECT a.body,a.sha256,e.artifact_id FROM enrichment_artifacts a JOIN enrichment_evidence e ON e.artifact_id=a.id WHERE e.id=$1",
        [evidence],
      )
    ).rows[0];
    assert.deepEqual(Buffer.from(row.body), body);
    assert.equal(row.sha256, createHash("sha256").update(body).digest("hex"));
    assert.equal(row.artifact_id, artifact.id);
  } finally {
    await restored.close();
  }
});
test("durable request exclusion, exact reservations and raw response survive repository restart", async () => {
  const { pg, db, store } = await fixture();
  try {
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "100",
    });
    const request = await store.planCollection({
      scope: "test",
      fingerprint: "same",
      generation: 0,
      operation: "read",
      args: {},
      policyId: "test-only",
    });
    const results = await Promise.allSettled([
      store.reserveAttempt({
        requestId: request.id,
        budgetId,
        capMicros: "70",
      }),
      store.reserveAttempt({
        requestId: request.id,
        budgetId,
        capMicros: "70",
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const attempt = results.find((r) => r.status === "fulfilled")!;
    assert.equal(attempt.status, "fulfilled");
    if (attempt.status !== "fulfilled") return;
    await store.markDispatched(attempt.value.id);
    await store.markUncertain(attempt.value.id, "worker restart");
    await assert.rejects(() =>
      new EnrichmentStore(db).reserveAttempt({
        requestId: request.id,
        budgetId,
        capMicros: "1",
      }),
    );
    const raw = Buffer.from("{malformed paid response");
    const artifact = await store.captureResponse({
      attemptId: attempt.value.id,
      body: raw,
      contentType: "application/json",
      redactionVersion: "test",
      paymentState: "settled",
      settledMicros: "50",
    });
    assert.deepEqual(
      Buffer.from(
        (await new EnrichmentStore(db).getReusableArtifact(request.id))!.body,
      ),
      raw,
    );
    await assert.rejects(() =>
      db.query("UPDATE enrichment_artifacts SET body=$2 WHERE id=$1", [
        artifact.id,
        Buffer.from("changed"),
      ]),
    );
    assert.equal(
      (
        await db.query<{ committed_micros: string }>(
          "SELECT committed_micros::text FROM enrichment_budgets",
        )
      ).rows[0].committed_micros,
      "50",
    );
    const next = await store.planCollection({
      scope: "test",
      fingerprint: "next",
      generation: 0,
      operation: "read",
      args: {},
      policyId: "test-only",
    });
    await assert.rejects(() =>
      store.reserveAttempt({ requestId: next.id, budgetId, capMicros: "51" }),
    );
  } finally {
    await pg.close();
  }
});
test("paid cap breach preserves body and blocks further budget use", async () => {
  const { pg, db, store } = await fixture();
  try {
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "100",
    });
    const req = await store.planCollection({
      scope: "test",
      fingerprint: "breach",
      generation: 0,
      operation: "read",
      args: {},
      policyId: "test-only",
    });
    const attempt = await store.reserveAttempt({
      requestId: req.id,
      budgetId,
      capMicros: "100",
    });
    await store.markDispatched(attempt.id);
    const body = Buffer.from("paid body");
    const result = await store.captureResponse({
      attemptId: attempt.id,
      body,
      contentType: "text/plain",
      redactionVersion: "none",
      paymentState: "settled",
      settledMicros: "101",
    });
    assert.deepEqual(
      Buffer.from((await store.getArtifact(result.id))!.body),
      body,
    );
    assert.equal(
      (
        await db.query<{ committed_micros: string }>(
          "SELECT committed_micros::text FROM enrichment_budgets",
        )
      ).rows[0].committed_micros,
      "101",
    );
  } finally {
    await pg.close();
  }
});

test("captured pending payment reconciles once without repurchase or loss of bytes", async () => {
  const { pg, db, store } = await fixture();
  try {
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "100",
    });
    for (const [index, paymentState] of ["pending", "uncertain"].entries()) {
      const request = await store.planCollection({
        scope: "test",
        fingerprint: `pending-${index}`,
        generation: 0,
        operation: "read",
        args: {},
        policyId: "test",
      });
      const attempt = await store.reserveAttempt({
        requestId: request.id,
        budgetId,
        capMicros: "50",
      });
      await store.markDispatched(attempt.id);
      const artifact = await store.captureResponse({
        attemptId: attempt.id,
        body: Buffer.from("captured"),
        contentType: "text/plain",
        redactionVersion: "none",
        paymentState: paymentState as "pending" | "uncertain",
      });
      const resolution = {
        paymentState:
          index === 0 ? ("settled" as const) : ("not_charged" as const),
        settledMicros: index === 0 ? "20" : "0",
        actor: "operator",
        evidence: "definitive provider lookup",
      };
      await store.reconcileCapturedPayment(attempt.id, resolution);
      await store.reconcileCapturedPayment(attempt.id, resolution);
      await assert.rejects(() =>
        store.reconcileCapturedPayment(attempt.id, {
          ...resolution,
          paymentState: "settled",
          settledMicros: "21",
        }),
      );
      await assert.rejects(() =>
        store.reserveAttempt({
          requestId: request.id,
          budgetId,
          capMicros: "1",
        }),
      );
      assert.deepEqual(
        Buffer.from((await store.getArtifact(artifact.id))!.body),
        Buffer.from("captured"),
      );
    }
    assert.equal(
      (
        await db.query<{ committed_micros: string }>(
          "SELECT committed_micros::text FROM enrichment_budgets",
        )
      ).rows[0].committed_micros,
      "20",
    );
  } finally {
    await pg.close();
  }
});
test("1001 campaign members stay frozen while intake and release reconciliation resume", async () => {
  const { pg, db, store } = await fixture();
  try {
    const evaluation = await store.putArtifact({
      kind: "legacy_import",
      body: Buffer.from("synthetic evaluation"),
      contentType: "text/plain",
      redactionVersion: "none",
      importBatch: "test",
    });
    const release = await store.createRelease({
      stages: ["collect", "extract", "dna", "embedding"],
    });
    await store.approveRelease(release, evaluation.id, {
      actor: "test",
      reason: "synthetic approval",
    });
    await store.promoteRelease("test", release, "initial");
    const members = Array.from({ length: 1001 }, () => randomUUID());
    await db.query(
      "INSERT INTO enrichment_entities(id,kind) SELECT unnest($1::uuid[]),'founder'",
      [members],
    );
    await db.query(
      "INSERT INTO enrichment_targets(entity_id,scope,release_id,revision) SELECT unnest($1::uuid[]),'test',$2,1",
      [members, release],
    );
    const campaign = await store.createCampaign({
      scope: "test",
      releaseId: release,
      entityIds: members,
      mode: "rederive",
    });
    const newcomer = await store.createEntity("founder", "new-arrival");
    await store.intake("test", newcomer);
    await new EnrichmentStore(db).reconcileTargets("test");
    await store.reconcileTargets("test");
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM enrichment_campaign_members WHERE campaign_id=$1",
          [campaign],
        )
      ).rows[0].count,
      1001,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM enrichment_stage_work",
        )
      ).rows[0].count,
      4008,
    );
    const next = await store.createRelease({
      stages: ["collect", "extract", "dna", "embedding"],
    });
    await store.approveRelease(next, evaluation.id, {
      actor: "test",
      reason: "next",
    });
    await store.promoteRelease("test", next, "new recipe");
    await store.reconcileTargets("test");
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM enrichment_targets WHERE release_id=$1",
          [next],
        )
      ).rows[0].count,
      1002,
    );
  } finally {
    await pg.close();
  }
});
test("publication rejects stale release and suppression removes shared-vector association only", async () => {
  const { pg, db, store } = await fixture();
  try {
    const artifact = await store.putArtifact({
      kind: "legacy_import",
      body: Buffer.from("{}"),
      contentType: "application/json",
      redactionVersion: "none",
      importBatch: "test",
    });
    const release = await store.createRelease({ stages: ["dna"] });
    await store.approveRelease(release, artifact.id, {
      actor: "test",
      reason: "approved",
    });
    await store.promoteRelease("test", release, "start");
    const first = await store.createEntity("founder", "one"),
      second = await store.createEntity("founder", "two");
    await store.intake("test", first);
    await store.intake("test", second);
    const run = (entityId: string) =>
      store.saveAnalysis({
        entityId,
        releaseId: release,
        generation: 0,
        purpose: "dna",
        inputArtifactId: artifact.id,
        inputDigest: "input",
        recipeDigest: "recipe",
        evidenceIds: [],
        output: { description: "same" },
        validationReport: { valid: true },
        status: "succeeded",
      });
    const a = await run(first),
      b = await run(second);
    assert.equal(await store.publishAnalysis(a), true);
    const vector = await store.saveEmbedding({
      scope: "test",
      text: "same",
      templateVersion: "v1",
      model: "synthetic",
      modelVersion: "v1",
      distance: "cosine",
      vector: [1, 0],
    });
    assert.equal(
      await store.saveEmbedding({
        scope: "test",
        text: "same",
        templateVersion: "v1",
        model: "synthetic",
        modelVersion: "v1",
        distance: "cosine",
        vector: [1, 0],
      }),
      vector,
    );
    await store.linkEmbedding(first, a, vector, "dna");
    await store.linkEmbedding(second, b, vector, "dna");
    await store.suppressEntity(first, "test withdrawal");
    assert.equal(await store.publishAnalysis(a), false);
    assert.equal(
      (await db.query("SELECT * FROM enrichment_analysis_embeddings")).rows
        .length,
      1,
    );
    const next = await store.createRelease({ stages: ["dna"] });
    await store.approveRelease(next, artifact.id, {
      actor: "test",
      reason: "approved",
    });
    await store.promoteRelease("test", next, "upgrade");
    await store.reconcileTargets("test");
    assert.equal(await store.publishAnalysis(b), false);
  } finally {
    await pg.close();
  }
});

test("required stages stay ordered; expired work blocks and withdrawal prevents replay", async () => {
  const { pg, db, store } = await fixture();
  try {
    const raw = await store.putArtifact({
      kind: "legacy_import",
      body: Buffer.from("synthetic source"),
      contentType: "text/plain",
      redactionVersion: "none",
      importBatch: "test",
    });
    const evidence = await store.addEvidence({
      artifactId: raw.id,
      extractorVersion: "v1",
      locator: "$",
      payload: { text: "synthetic source" },
      excerpt: "synthetic source",
    });
    assert.equal(
      await store.addEvidence({
        artifactId: raw.id,
        extractorVersion: "v1",
        locator: "$",
        payload: { text: "synthetic source" },
        excerpt: "synthetic source",
      }),
      evidence,
    );
    await assert.rejects(() =>
      store.addEvidence({
        artifactId: raw.id,
        extractorVersion: "v1",
        locator: "$",
        payload: { text: "changed" },
        excerpt: "changed",
      }),
    );
    const release = await store.createRelease({
      stages: ["collect", "extract", "dna"],
      recipes: { dna: "recipe" },
    });
    await store.approveRelease(release, raw.id, {
      actor: "test",
      reason: "offline",
    });
    await store.promoteRelease("test", release, "initial");
    const entityId = await store.createEntity("founder", "ordered");
    await store.linkEvidence(entityId, evidence, "source");
    const product = await store.createEntity("product", "synthetic-product");
    await store.linkProduct(entityId, product, evidence);
    await store.linkProduct(entityId, product, evidence);
    await store.intake("test", entityId);
    await store.intake("test", entityId);
    const trusted = {
      entityId,
      releaseId: release,
      generation: 0,
      purpose: "dna",
      recipeDigest: "recipe",
      evidence: [
        {
          id: evidence,
          artifactId: raw.id,
          contentHash: createHash("sha256")
            .update(JSON.stringify("synthetic source"))
            .digest("hex"),
          text: "synthetic source",
        },
      ],
    };
    await store.assertAnalysisInputs(trusted);
    await assert.rejects(() =>
      store.assertAnalysisInputs({
        ...trusted,
        evidence: [{ ...trusted.evidence[0], text: "invented source" }],
      }),
    );
    await store.reconcileTargets("test");
    const first = await store.claimStage();
    assert.equal(first?.stage, "collect");
    assert.equal(await store.claimStage(), null);
    await assert.rejects(() =>
      store.finishStage({
        id: first!.id,
        leaseToken: first!.leaseToken,
        status: "not_applicable",
        reason: "unsupported",
      }),
    );
    await store.finishStage({
      id: first!.id,
      leaseToken: first!.leaseToken,
      status: "succeeded",
    });
    const second = await store.claimStage();
    assert.equal(second?.stage, "extract");
    await db.query(
      "UPDATE enrichment_stage_work SET lease_until=now()-interval '1 second' WHERE id=$1",
      [second!.id],
    );
    await store.recoverExpiredLeases();
    assert.equal(await store.claimStage(), null);
    const id = randomUUID();
    const input = {
      id,
      entityId,
      releaseId: release,
      generation: 0,
      purpose: "dna",
      inputArtifactId: raw.id,
      inputDigest: "input",
      recipeDigest: "recipe",
      evidenceIds: [evidence],
      output: { description: "synthetic" },
      validationReport: { valid: true },
      status: "succeeded" as const,
    };
    assert.equal(await store.saveAnalysis(input), id);
    assert.equal(await store.saveAnalysis(input), id);
    await assert.rejects(() =>
      store.saveAnalysis({ ...input, output: { description: "changed" } }),
    );
    assert.equal(await store.publishAnalysis(id), true);
    await store.withdrawArtifact(raw.id, "test", "withdrawn");
    await assert.rejects(() => store.assertAnalysisInputs(trusted));
    assert.equal(await store.getArtifact(raw.id), null);
    assert.equal(await store.publishAnalysis(id), false);
    assert.equal(
      await store.findSuccessfulAnalysis({
        entityId,
        purpose: "dna",
        inputDigest: "input",
        recipeDigest: "recipe",
      }),
      null,
    );
    assert.equal(
      (await db.query("SELECT * FROM enrichment_profiles")).rows.length,
      0,
    );
  } finally {
    await pg.close();
  }
});

test("withdrawal physically clears derived payloads and late completions without losing accounting", async () => {
  const { pg, db, store } = await fixture();
  try {
    const entityId = await store.createEntity("founder", "purge-test");
    const source = await store.putArtifact({
      kind: "legacy_import",
      body: Buffer.from("private source"),
      contentType: "text/plain",
      redactionVersion: "none",
      importBatch: "test",
    });
    const evidence = await store.addEvidence({
      artifactId: source.id,
      extractorVersion: "v1",
      locator: "$",
      payload: { text: "private source" },
      excerpt: "private source",
      sourceUrl: "https://example.com/source",
    });
    await store.linkEvidence(entityId, evidence, "source");
    const release = await store.createRelease({ stages: ["dna"] });
    await store.approveRelease(release, source.id, {
      actor: "test",
      reason: "synthetic",
    });
    await store.promoteRelease("test", release, "start");
    await store.intake("test", entityId);
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "100",
    });
    const request = await store.planCollection({
      scope: "test",
      fingerprint: "generation",
      generation: 0,
      operation: "generate",
      args: { prompt: "private source" },
      policyId: "test-only",
    });
    const attempt = await store.reserveAttempt({
      requestId: request.id,
      budgetId,
      capMicros: "100",
    });
    const requestArtifact = await store.putArtifact({
      kind: "generation_request",
      body: Buffer.from("private prompt"),
      contentType: "text/plain",
      redactionVersion: "none",
      attemptId: attempt.id,
    });
    await store.markDispatched(attempt.id);
    const response = await store.captureResponse({
      attemptId: attempt.id,
      kind: "generation_response",
      body: Buffer.from("private output"),
      contentType: "text/plain",
      redactionVersion: "none",
      paymentState: "settled",
      settledMicros: "50",
    });
    const runId = randomUUID();
    const manifest = await store.putArtifact({
      kind: "manifest",
      body: Buffer.from("private context"),
      contentType: "text/plain",
      redactionVersion: "none",
      runId,
    });
    const run = {
      id: runId,
      entityId,
      releaseId: release,
      generation: 0,
      purpose: "dna",
      inputArtifactId: manifest.id,
      inputDigest: "input",
      recipeDigest: "recipe",
      evidenceIds: [evidence],
      output: { description: "private output" },
      validationReport: {
        attemptId: attempt.id,
        responseArtifactId: response.id,
      },
      status: "succeeded" as const,
    };
    await store.saveAnalysis(run);
    await store.publishAnalysis(runId);
    const vector = await store.saveEmbedding({
      scope: "test",
      text: "private output",
      templateVersion: "v1",
      model: "synthetic",
      modelVersion: "v1",
      distance: "cosine",
      vector: [1, 0],
    });
    await store.linkEmbedding(entityId, runId, vector, "dna");
    await store.withdrawArtifact(
      source.id,
      "test",
      "source permission withdrawn",
    );
    for (const id of [source.id, manifest.id, requestArtifact.id, response.id])
      assert.equal(await store.getArtifact(id), null);
    assert.deepEqual(
      (
        await db.query<{ payload: unknown; excerpt: string }>(
          "SELECT payload,excerpt FROM enrichment_evidence WHERE id=$1",
          [evidence],
        )
      ).rows[0],
      { payload: {}, excerpt: "" },
    );
    assert.equal(
      (await db.query("SELECT * FROM enrichment_embeddings")).rows.length,
      0,
    );
    assert.equal(await store.findAnalysis(runId), null);
    assert.deepEqual(
      (
        await db.query<{ args: unknown }>(
          "SELECT args FROM enrichment_collection_requests WHERE id=$1",
          [request.id],
        )
      ).rows[0].args,
      {},
    );
    assert.equal(
      (
        await db.query<{ committed_micros: string }>(
          "SELECT committed_micros::text FROM enrichment_budgets",
        )
      ).rows[0].committed_micros,
      "50",
    );
    const lateId = randomUUID();
    const lateManifest = await store.putArtifact({
      kind: "manifest",
      body: Buffer.from("late private context"),
      contentType: "text/plain",
      redactionVersion: "none",
      runId: lateId,
    });
    await store.saveAnalysis({
      ...run,
      id: lateId,
      inputArtifactId: lateManifest.id,
    });
    assert.equal(await store.getArtifact(lateManifest.id), null);
    assert.equal(await store.findAnalysis(lateId), null);
  } finally {
    await pg.close();
  }
});
