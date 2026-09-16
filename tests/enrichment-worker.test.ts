import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  migrateEnrichment,
  type Database,
  type Sql,
} from "../lib/enrichment/db";
import { EnrichmentStore } from "../lib/enrichment/store";
import { WorkerStore } from "../lib/enrichment/worker-store";
import {
  createStageHandlers,
  buildWorkerManifest,
  type WorkerDependencies,
} from "../lib/enrichment/worker";
import { runPendingStages } from "../lib/enrichment/pipeline";

async function fixture(
  options: { products?: "absent" | "unknown"; protected?: boolean } = {},
) {
  const pg = new PGlite();
  const adapt = (client: Pick<PGlite, "query" | "exec">): Sql => ({
    async query<T>(text: string, values?: unknown[]) {
      if (!values && text.includes(";")) {
        await client.exec(text);
        return { rows: [] as T[] };
      }
      return client.query<T>(text, values);
    },
  });
  const db: Database = {
    ...adapt(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapt(tx))),
  };
  await migrateEnrichment(db);
  const store = new EnrichmentStore(db);
  const evaluation = await store.putArtifact({
    kind: "legacy_import",
    body: Buffer.from("synthetic evaluation"),
    contentType: "text/plain",
    redactionVersion: "none",
    importBatch: "test",
  });
  const configuration = {
    codeDigest: "synthetic-v1",
    model: { provider: "synthetic", model: "fixture", revision: "v1" },
    embedding: { model: "fixture", modelVersion: "v1", dimensions: 2 },
  };
  const releaseId = await store.createRelease(
    buildWorkerManifest(configuration),
  );
  await store.approveRelease(releaseId, evaluation.id, {
    actor: "test",
    reason: "synthetic",
  });
  await store.promoteRelease("test", releaseId, "synthetic approval");
  const budgetId = randomUUID();
  await store.createBudget({
    id: budgetId,
    scope: "test",
    currency: "USD",
    capMicros: "1000",
  });
  let collections = 0,
    generations = 0,
    embeddings = 0;
  async function capture(
    operation: string,
    body: string,
    kind: "source_response" | "generation_response",
    key: string,
  ) {
    const request = await store.planCollection({
      scope: "test",
      fingerprint: key,
      generation: 0,
      operation,
      args: { key },
      policyId: "synthetic",
    });
    const attempt = await store.reserveAttempt({
      requestId: request.id,
      budgetId,
      capMicros: "1",
    });
    await store.markDispatched(attempt.id);
    const artifact = await store.captureResponse({
      attemptId: attempt.id,
      body: Buffer.from(body),
      contentType: "application/json",
      redactionVersion: "none",
      paymentState: "settled",
      settledMicros: "1",
      kind,
    });
    return { artifact, attempt };
  }
  const dependencies: WorkerDependencies = {
    mode: "acquire",
    codeDigest: "synthetic-v1",
    model: { provider: "synthetic", model: "fixture", revision: "v1" },
    embedding: { model: "fixture", modelVersion: "v1", dimensions: 2 },
    async collectProfile(input) {
      collections++;
      const { artifact } = await capture(
        "source",
        JSON.stringify({
          data: {
            privacy: { protected: options.protected ?? false },
            core: { name: "Synthetic Founder", screen_name: input.legacyKey },
            profile_bio: {
              description:
                options.products === "absent"
                  ? "I have not built any products."
                  : options.products === "unknown"
                    ? "I like building."
                    : "I built Synthetic Product for testing.",
            },
          },
        }),
        "source_response",
        `profile:${input.entityId}`,
      );
      return { status: "captured", artifactId: artifact.id };
    },
    async executeGeneration(input) {
      generations++;
      const ids = input.request.evidence.map((e) => e.id);
      const claims = input.request.recipe.claimFields!.map((field) => ({
        field: field.name,
        value:
          field.name === "products" && options.products === "unknown"
            ? null
            : field.name === "products" && options.products === "absent"
              ? []
              : field.name === "products"
                ? [
                    {
                      name: "Synthetic Product",
                      website: null,
                      evidenceIds: ids,
                    },
                  ]
                : `Synthetic ${field.name}`,
        kind: "self_report",
        state:
          field.name === "products"
            ? (options.products ?? "supported")
            : "supported",
        evidenceIds: ids,
      }));
      const rawResponse = JSON.stringify({
        schemaVersion: "claims-v1",
        claims,
      });
      const { artifact, attempt } = await capture(
        "generation",
        rawResponse,
        "generation_response",
        input.runId,
      );
      return {
        attemptId: attempt.id,
        responseArtifactId: artifact.id,
        rawResponse,
        usage: { tokens: 1 },
        finishReason: "stop",
      };
    },
    async embed(input) {
      embeddings++;
      const { artifact, attempt } = await capture(
        "embedding",
        JSON.stringify({ vector: [0.1, 0.2] }),
        "generation_response",
        `embed:${input.entityId}:${input.analysisId}`,
      );
      return {
        vector: [0.1, 0.2],
        attemptId: attempt.id,
        responseArtifactId: artifact.id,
      };
    },
  };
  return {
    pg,
    db,
    store,
    releaseId,
    dependencies,
    counters: () => ({ collections, generations, embeddings }),
  };
}

test("existing founders and new intake use durable source-to-DNA/product/vector stages; rederive does not recollect", async () => {
  const f = await fixture();
  try {
    const founder = await f.store.createEntity("founder", "synthetic_one");
    await f.store.intake("test", founder);
    await f.store.reconcileTargets("test");
    const handlers = createStageHandlers(
      f.store,
      new WorkerStore(f.db),
      f.dependencies,
    );
    assert.equal(
      (
        await runPendingStages(f.store, handlers, {
          limit: 20,
          leaseSeconds: 60,
        })
      ).processed,
      6,
    );
    const statuses = (
      await f.db.query<{ status: string }>(
        "SELECT status FROM enrichment_stage_work WHERE entity_id=$1",
        [founder],
      )
    ).rows;
    assert.ok(statuses.every((row) => row.status === "succeeded"));
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM enrichment_founder_products WHERE founder_id=$1",
          [founder],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM enrichment_profiles")).rows.length,
      2,
    );
    assert.equal(f.counters().collections, 1);
    const second = await f.store.createEntity("founder", "synthetic_two");
    await f.store.intake("test", second);
    await f.store.reconcileTargets("test");
    await runPendingStages(f.store, handlers, { limit: 20, leaseSeconds: 60 });
    assert.equal(f.counters().collections, 2);
    const evaluation = await f.store.putArtifact({
      kind: "legacy_import",
      body: Buffer.from("new evaluation"),
      contentType: "text/plain",
      redactionVersion: "none",
      importBatch: "test2",
    });
    const nextRelease = await f.store.createRelease(
      buildWorkerManifest(f.dependencies),
    );
    await f.store.approveRelease(nextRelease, evaluation.id, {
      actor: "test",
      reason: "synthetic",
    });
    await f.store.promoteRelease("test", nextRelease, "rederive test");
    await f.store.reconcileTargets("test");
    const rederive = createStageHandlers(f.store, new WorkerStore(f.db), {
      ...f.dependencies,
      mode: "rederive",
      collectProfile: async () => {
        throw new Error("source must not run");
      },
    });
    await runPendingStages(f.store, rederive, { limit: 50, leaseSeconds: 60 });
    assert.equal(f.counters().collections, 2);
    const latest = (
      await f.db.query<{ status: string }>(
        "SELECT status FROM enrichment_stage_work WHERE release_id=$1 AND entity_id IN ($2,$3)",
        [nextRelease, founder, second],
      )
    ).rows;
    assert.equal(latest.length, 12);
    assert.ok(latest.every((row) => row.status === "succeeded"));
  } finally {
    await f.pg.close();
  }
});

test("explicit no-product evidence completes with N/A; unknown and protected profiles stay partial", async () => {
  for (const options of [
    { products: "absent" as const },
    { products: "unknown" as const },
    { protected: true },
  ]) {
    const f = await fixture(options);
    try {
      const founder = await f.store.createEntity(
        "founder",
        "synthetic_partial",
      );
      await f.store.intake("test", founder);
      await f.store.reconcileTargets("test");
      await runPendingStages(
        f.store,
        createStageHandlers(f.store, new WorkerStore(f.db), f.dependencies),
        { limit: 20, leaseSeconds: 60 },
      );
      const states = (
        await f.db.query<{ stage: string; status: string }>(
          "SELECT stage,status FROM enrichment_stage_work WHERE entity_id=$1",
          [founder],
        )
      ).rows;
      if (options.products === "absent") {
        assert.equal(
          states.find((row) => row.stage === "product_descriptions")?.status,
          "not_applicable",
        );
        assert.equal(
          states.find((row) => row.stage === "founder_dna")?.status,
          "succeeded",
        );
      } else {
        assert.equal(
          states.find(
            (row) =>
              row.stage ===
              (options.protected ? "extraction" : "product_discovery"),
          )?.status,
          "unavailable",
        );
        assert.equal(
          states.find((row) => row.stage === "founder_dna")?.status,
          "pending",
        );
      }
      assert.equal(
        (await f.db.query("SELECT * FROM enrichment_founder_products")).rows
          .length,
        0,
      );
    } finally {
      await f.pg.close();
    }
  }
});

test("unapproved worker configuration cannot collect or generate", async () => {
  const f = await fixture();
  try {
    const founder = await f.store.createEntity("founder", "synthetic_config");
    await f.store.intake("test", founder);
    await f.store.reconcileTargets("test");
    await runPendingStages(
      f.store,
      createStageHandlers(f.store, new WorkerStore(f.db), {
        ...f.dependencies,
        codeDigest: "unapproved",
      }),
      { limit: 10, leaseSeconds: 60 },
    );
    assert.deepEqual(f.counters(), {
      collections: 0,
      generations: 0,
      embeddings: 0,
    });
  } finally {
    await f.pg.close();
  }
});
