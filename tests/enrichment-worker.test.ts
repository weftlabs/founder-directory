import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
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
  selectProductEvidence,
  extractProfile,
  type WorkerDependencies,
} from "../lib/enrichment/worker";
import { runPendingStages } from "../lib/enrichment/pipeline";
import type { EvidenceInput } from "../lib/enrichment/contracts";
import { collectWebsite } from "../lib/enrichment/website";
import type { WeftTransport } from "../lib/weft";

test("Atlas website expansion uses only one exact safe mapping", () => {
  const short = "https://t.co/verified";
  const entry = { url: short, expanded_url: "https://product.example/" };
  for (const [urls, expected] of [
    [[entry], "https://product.example/"],
    [[{ ...entry, url: "https://t.co/unrelated" }], short],
    [[{ ...entry, expanded_url: "http://127.0.0.1/" }], null],
    [
      [{ ...entry, expanded_url: "https://user:password@product.example/" }],
      null,
    ],
    [[entry, entry], null],
    [[entry, { ...entry, expanded_url: "https://other.example/" }], null],
  ] as const) {
    const result = extractProfile(
      Buffer.from(
        JSON.stringify({
          data: {
            core: { name: "Builder", screen_name: "builder" },
            website: { url: short },
            profile_bio: {
              description: "Builds tools",
              entities: { url: { urls } },
            },
          },
        }),
      ),
    );
    assert.equal(result.status, "available");
    if (result.status === "available")
      assert.equal(result.payload.website, expected);
  }
});

test("product-only and unlabeled evidence make personal DNA unavailable without generation", async () => {
  for (const sourceKind of ["product-site", undefined]) {
    let generations = 0;
    const worker = {
      async assertConfiguration() {},
      async stageOutput() {
        return "source-artifact";
      },
      async evidenceByIds(): Promise<EvidenceInput[]> {
        return [
          {
            id: "source",
            artifactId: "source-artifact",
            contentHash: "unused",
            text: "Synthetic source text",
            sourceUrl: null,
            extractorVersion: "test",
            ...(sourceKind
              ? { provenance: { sourceKind, observedAt: null } }
              : {}),
          },
        ];
      },
    } as unknown as WorkerStore;
    const handlers = createStageHandlers(
      {
        async getArtifact() {
          return {
            kind: "manifest",
            body: Buffer.from(
              JSON.stringify({
                version: "profile-website-evidence-v1",
                evidenceIds: ["source"],
                artifactIds: [],
                website: { status: "captured" },
              }),
            ),
          };
        },
      } as unknown as EnrichmentStore,
      worker,
      {
        mode: "rederive",
        codeDigest: "test",
        model: { provider: "fixture", model: "fixture", revision: null },
        async executeGeneration() {
          generations++;
          throw new Error("unexpected model dispatch");
        },
      },
    );
    assert.deepEqual(
      await handlers.founder_dna({
        id: "work",
        leaseToken: "lease",
        entityId: "founder",
        releaseId: "release",
        generation: 0,
        stage: "founder_dna",
      }),
      { status: "unavailable", reason: "no_personal_evidence" },
    );
    assert.equal(generations, 0);
  }
});

test("product context retains uncited excerpts from the exact product page only", () => {
  const evidence: EvidenceInput[] = [
    ["ownership", "https://social.example/founder"],
    ["description", "https://product.example/tool"],
    ["roadmap", "https://product.example/tool/#roadmap"],
    ["sibling", "https://product.example/other"],
    ["query", "https://product.example/tool?product=other"],
    ["other-host", "https://other.example/tool"],
    ["no-source", null],
  ].map(([id, sourceUrl]) => ({
    id: id!,
    artifactId: `artifact-${id}`,
    contentHash: `hash-${id}`,
    text: `Synthetic ${id}`,
    sourceUrl,
    extractorVersion: "test-v1",
  }));
  const product = {
    website: "https://product.example/tool/",
    evidenceIds: ["ownership", "description"],
  };
  const before = structuredClone({ evidence, product });
  assert.deepEqual(
    selectProductEvidence(product, evidence).map((row) => row.id),
    ["ownership", "description", "roadmap"],
  );
  assert.deepEqual({ evidence, product }, before);
});

test("product context does not expand null, malformed, or non-HTTP websites", () => {
  for (const website of [
    null,
    "not a URL",
    "file:///product",
    "javascript:alert(1)",
  ]) {
    const evidence: EvidenceInput[] = ["cited", "uncited"].map((id) => ({
      id,
      artifactId: `artifact-${id}`,
      contentHash: `hash-${id}`,
      text: "Synthetic evidence",
      sourceUrl: website,
      extractorVersion: "test-v1",
    }));
    assert.deepEqual(
      selectProductEvidence({ website, evidenceIds: ["cited"] }, evidence).map(
        (row) => row.id,
      ),
      ["cited"],
    );
  }
});

async function fixture(
  options: {
    products?: "absent" | "unknown";
    protected?: boolean;
    website?: boolean;
    websiteProvider?: "exa" | "jina";
    websiteFailure?: boolean;
    mismatchedProfile?: boolean;
  } = {},
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
    ...(options.website
      ? { website: { provider: options.websiteProvider ?? ("exa" as const) } }
      : {}),
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
    websites = 0,
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
      metadata:
        operation === "website"
          ? {
              sourceKind: "product-site",
              status: 200,
              requestedUrl: "https://synthetic.example/",
            }
          : operation === "source"
            ? {
                sourceKind: "self-reported",
                observedAt: "2026-09-20T00:00:00Z",
              }
            : {},
    });
    return { artifact, attempt };
  }
  const dependencies: WorkerDependencies = {
    mode: "acquire",
    codeDigest: "synthetic-v1",
    model: { provider: "synthetic", model: "fixture", revision: "v1" },
    embedding: { model: "fixture", modelVersion: "v1", dimensions: 2 },
    ...(options.website
      ? { website: { provider: options.websiteProvider ?? ("exa" as const) } }
      : {}),
    async collectProfile(input) {
      collections++;
      const { artifact } = await capture(
        "source",
        JSON.stringify({
          data: {
            privacy: { protected: options.protected ?? false },
            core: {
              name: "Synthetic Founder",
              screen_name: options.mismatchedProfile
                ? "someone_else"
                : input.legacyKey,
            },
            ...(options.website
              ? { website: { url: "https://synthetic.example" } }
              : {}),
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
    async collectWebsite(input) {
      websites++;
      if (options.websiteFailure)
        return { status: "unavailable", reason: "website_url_failed" };
      assert.equal(input.websiteUrl, "https://synthetic.example/");
      assert.ok(await store.getArtifact(input.sourceProfileArtifactId));
      const { artifact } = await capture(
        "website",
        JSON.stringify(
          input.provider === "jina"
            ? {
                code: 200,
                data: {
                  url: input.websiteUrl,
                  content: "Synthetic Product helps test teams check fixtures.",
                },
              }
            : {
                statuses: [{ id: input.websiteUrl, status: "success" }],
                results: [
                  {
                    url: input.websiteUrl,
                    text: "Synthetic Product helps test teams check fixtures.",
                  },
                ],
              },
        ),
        "source_response",
        `website:${input.entityId}`,
      );
      return { status: "captured", artifactId: artifact.id };
    },
    async executeGeneration(input) {
      generations++;
      const ids = input.request.evidence.map((e) => e.id);
      assert.ok(
        input.request.evidence.every(
          (e) => !e.text.includes("UNRELATED_GENERATION"),
        ),
      );
      if (options.website) {
        assert.equal(
          input.request.evidence.some(
            (e) => e.provenance?.sourceKind === "product-site",
          ),
          !options.websiteFailure &&
            input.request.recipe.purpose !== "founder_dna",
        );
      }
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
                      website: options.website
                        ? "https://synthetic.example"
                        : null,
                      evidenceIds: ids,
                    },
                  ]
                : `Synthetic ${field.name}`,
        kind: input.request.evidence.every(
          (row) => row.provenance?.sourceKind === "self-reported",
        )
          ? "self_report"
          : "inference",
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
    websiteCalls: () => websites,
  };
}

for (const websiteProvider of ["exa", "jina"] as const)
  test(`${websiteProvider}: existing founders and new intake use durable source-to-DNA/product/vector stages; rederive does not recollect`, async () => {
    const f = await fixture({ website: true, websiteProvider });
    try {
      const founder = await f.store.createEntity("founder", "synthetic_one");
      const unrelated = await f.store.putArtifact({
        kind: "legacy_import",
        body: Buffer.from("UNRELATED_GENERATION"),
        contentType: "text/plain",
        redactionVersion: "none",
        importBatch: "old",
      });
      const unrelatedEvidence = await f.store.addEvidence({
        artifactId: unrelated.id,
        extractorVersion: "old",
        locator: "old",
        payload: {},
        excerpt: "UNRELATED_GENERATION",
      });
      await f.store.linkEvidence(founder, unrelatedEvidence, "old");
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
        2,
      );
      assert.equal(
        (await f.db.query("SELECT * FROM enrichment_profiles")).rows.length,
        2,
      );
      assert.equal(f.counters().collections, 1);
      assert.equal(f.websiteCalls(), 1);
      const second = await f.store.createEntity("founder", "synthetic_two");
      await f.store.intake("test", second);
      await f.store.reconcileTargets("test");
      await runPendingStages(f.store, handlers, {
        limit: 20,
        leaseSeconds: 60,
      });
      assert.equal(f.counters().collections, 2);
      const evaluation = await f.store.putArtifact({
        kind: "legacy_import",
        body: Buffer.from("new evaluation"),
        contentType: "text/plain",
        redactionVersion: "none",
        importBatch: "test2",
      });
      const replayConfiguration = {
        ...f.dependencies,
        website: {
          provider:
            websiteProvider === "jina" ? ("exa" as const) : ("jina" as const),
        },
      };
      const nextRelease = await f.store.createRelease(
        buildWorkerManifest(replayConfiguration),
      );
      await f.store.approveRelease(nextRelease, evaluation.id, {
        actor: "test",
        reason: "synthetic",
      });
      await f.store.promoteRelease("test", nextRelease, "rederive test");
      await f.store.reconcileTargets("test");
      const rederive = createStageHandlers(f.store, new WorkerStore(f.db), {
        ...replayConfiguration,
        // Saved bundle provider must win over a changed current preference.
        website: { provider: websiteProvider === "jina" ? "exa" : "jina" },
        mode: "rederive",
        collectProfile: async () => {
          throw new Error("source must not run");
        },
        collectWebsite: async () => {
          throw new Error("website must not run");
        },
      });
      await runPendingStages(f.store, rederive, {
        limit: 50,
        leaseSeconds: 60,
      });
      assert.equal(f.counters().collections, 2);
      assert.equal(f.websiteCalls(), 2);
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
          options.protected ? "pending" : "succeeded",
        );
      }
      assert.equal(
        (await f.db.query("SELECT * FROM enrichment_founder_products")).rows
          .length,
        0,
      );
      if (!options.protected) {
        assert.equal(
          states.find((row) => row.stage === "embeddings")?.status,
          "succeeded",
        );
        assert.equal(
          (
            await f.db.query(
              "SELECT * FROM enrichment_analysis_embeddings WHERE entity_id=$1 AND purpose='founder_dna'",
              [founder],
            )
          ).rows.length,
          1,
        );
      }
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

test("expired stage lease cannot start a paid source call", async () => {
  const f = await fixture();
  try {
    const founder = await f.store.createEntity("founder", "synthetic_expiry");
    await f.store.intake("test", founder);
    await f.store.reconcileTargets("test");
    const work = await f.store.claimStage(60, "test");
    assert.ok(work);
    await f.db.query(
      "UPDATE enrichment_stage_work SET lease_until=now()-interval '1 second' WHERE id=$1",
      [work.id],
    );
    const handlers = createStageHandlers(
      f.store,
      new WorkerStore(f.db),
      f.dependencies,
    );
    await assert.rejects(handlers.collection(work));
    assert.deepEqual(f.counters(), {
      collections: 0,
      generations: 0,
      embeddings: 0,
    });
  } finally {
    await f.pg.close();
  }
});

test("website failure preserves personal DNA but marks descriptions unavailable", async () => {
  const f = await fixture({ website: true, websiteFailure: true });
  try {
    const founder = await f.store.createEntity("founder", "synthetic_failure");
    await f.store.intake("test", founder);
    await f.store.reconcileTargets("test");
    await runPendingStages(
      f.store,
      createStageHandlers(f.store, new WorkerStore(f.db), f.dependencies),
      { limit: 20, leaseSeconds: 60 },
    );
    const rows = (
      await f.db.query<{ stage: string; status: string }>(
        "SELECT stage,status FROM enrichment_stage_work WHERE entity_id=$1",
        [founder],
      )
    ).rows;
    assert.equal(
      rows.find((r) => r.stage === "founder_dna")?.status,
      "succeeded",
    );
    assert.equal(
      rows.find((r) => r.stage === "product_descriptions")?.status,
      "unavailable",
    );
    assert.equal(f.websiteCalls(), 1);
  } finally {
    await f.pg.close();
  }
});

test("profile identity mismatch blocks website purchase", async () => {
  const f = await fixture({ website: true, mismatchedProfile: true });
  try {
    const founder = await f.store.createEntity("founder", "synthetic_target");
    await f.store.intake("test", founder);
    await f.store.reconcileTargets("test");
    const result = await runPendingStages(
      f.store,
      createStageHandlers(f.store, new WorkerStore(f.db), f.dependencies),
      { limit: 20, leaseSeconds: 60 },
    );
    assert.deepEqual(result, { processed: 1, counts: { blocked: 1 } });
    assert.equal(f.websiteCalls(), 0);
    assert.equal(f.counters().generations, 0);
  } finally {
    await f.pg.close();
  }
});

test("withdrawing a source profile purges pre-analysis worker manifests that retain its website URL", async () => {
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
  const configuration = {
    codeDigest: "synthetic-v1",
    model: { provider: "synthetic", model: "fixture", revision: "v1" },
    website: { provider: "exa" as const },
  };
  const evaluation = await store.putArtifact({
    kind: "legacy_import",
    body: Buffer.from("synthetic evaluation"),
    contentType: "text/plain",
    redactionVersion: "none",
    importBatch: "retention-evaluation",
  });
  const releaseId = await store.createRelease(
    buildWorkerManifest(configuration),
  );
  await store.approveRelease(releaseId, evaluation.id, {
    actor: "test",
    reason: "synthetic",
  });
  await store.promoteRelease("test", releaseId, "retention");
  const budgetId = randomUUID();
  const unrelatedBudgetId = randomUUID();
  await store.createBudget({
    id: budgetId,
    scope: "test",
    currency: "USD",
    capMicros: "5000",
  });
  await store.createBudget({
    id: unrelatedBudgetId,
    scope: "other",
    currency: "USD",
    capMicros: "80",
  });
  const founder = await store.createEntity("founder", "retained_founder");
  await store.intake("test", founder);
  await store.reconcileTargets("test");
  let profileId = "";
  let websiteId = "";
  const websiteUrl = "https://retained.example/product";
  const dependencies: WorkerDependencies = {
    mode: "acquire",
    ...configuration,
    async collectProfile() {
      const request = await store.planCollection({
        scope: "test",
        fingerprint: "retained-profile",
        generation: 0,
        operation: "source",
        args: { handle: "retained_founder" },
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
        kind: "source_response",
        body: Buffer.from(
          JSON.stringify({
            data: {
              core: {
                name: "Retained Founder",
                screen_name: "retained_founder",
              },
              website: { url: websiteUrl },
              profile_bio: { description: "Builds a retained product." },
            },
          }),
        ),
        contentType: "application/json",
        redactionVersion: "none",
        paymentState: "settled",
        settledMicros: "1",
        metadata: { sourceKind: "self-reported" },
      });
      profileId = artifact.id;
      return { status: "captured", artifactId: artifact.id };
    },
    async collectWebsite(input) {
      const client: WeftTransport = {
        fetch: async (request) => {
          const requested = (
            JSON.parse(String(request.body)) as { urls: string[] }
          ).urls[0];
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            bodyBase64: Buffer.from(
              JSON.stringify({
                statuses: [{ id: requested, status: "success" }],
                results: [
                  {
                    url: requested,
                    text: "Retained product page text.",
                  },
                ],
              }),
            ).toString("base64"),
            paidUsd: "0.001",
            heldUsd: "0",
            paymentStatus: "settled",
            txHash: "synthetic",
            artifactId: 1,
            merchant: {
              address: "synthetic",
              settlementCount: 1,
              firstSeenAt: new Date(0),
              disputeCount: 0,
            },
          };
        },
      };
      const result = await collectWebsite(
        store,
        client,
        {
          scope: "test",
          budgetId,
          generation: input.generation,
          mode: "acquire",
          policy: {
            id: "synthetic-website",
            scope: "test",
            operation: "exa-contents",
            storageVerified: true,
            retentionApproved: true,
          },
          maxCostUsd: "0.001",
          provider: input.provider,
          websiteUrl: input.websiteUrl,
          sourceProfileArtifactId: input.sourceProfileArtifactId,
        },
        () => true,
      );
      assert.equal(result.status, "captured");
      if (result.status !== "captured")
        return { status: "unavailable", reason: "website_not_captured" };
      websiteId = result.artifact.id;
      return { status: "captured", artifactId: result.artifact.id };
    },
    async executeGeneration() {
      throw new Error("analysis must not run before withdrawal");
    },
  };
  const handlers = createStageHandlers(
    store,
    new WorkerStore(db),
    dependencies,
  );
  assert.deepEqual(
    await runPendingStages(
      store,
      {
        collection: handlers.collection,
        extraction: handlers.extraction,
      },
      { limit: 2, leaseSeconds: 60 },
    ),
    { processed: 2, counts: { succeeded: 2 } },
  );
  assert.equal(
    (await db.query("SELECT id FROM enrichment_analysis_runs")).rows.length,
    0,
  );
  const written = (
    await db.query<{ id: string; purpose: string; body: string }>(
      `SELECT id, metadata->>'purpose' AS purpose, convert_from(body,'UTF8') AS body
       FROM enrichment_artifacts
       WHERE metadata->>'purpose' IN ('worker_source_bundle','worker_extraction')`,
    )
  ).rows;
  const sourceBundle = written.find(
    (row) => row.purpose === "worker_source_bundle",
  );
  const extraction = written.find((row) => row.purpose === "worker_extraction");
  assert.ok(sourceBundle && extraction);
  assert.ok(profileId && websiteId);
  assert.match(sourceBundle.body, /https:\/\/retained\.example\/product/);
  assert.match(extraction.body, /https:\/\/retained\.example\/product/);
  const tracked = (
    await db.query<{ purpose: string; ids: string[] }>(
      `SELECT metadata->>'purpose' AS purpose,
         ARRAY(SELECT jsonb_array_elements_text(metadata->'sourceArtifactIds')) AS ids
       FROM enrichment_artifacts WHERE id=ANY($1::uuid[])`,
      [[sourceBundle.id, extraction.id]],
    )
  ).rows;
  assert.deepEqual(
    tracked.find((row) => row.purpose === "worker_source_bundle")?.ids.sort(),
    [profileId, websiteId].sort(),
  );
  assert.deepEqual(
    new Set(tracked.find((row) => row.purpose === "worker_extraction")?.ids),
    new Set([profileId, websiteId, sourceBundle.id]),
  );
  const insertManifest = async (
    id: string,
    batch: string,
    body: unknown,
    metadata: Record<string, unknown>,
  ) => {
    const bytes = Buffer.from(JSON.stringify(body));
    await db.query(
      "INSERT INTO enrichment_artifacts(id,kind,import_batch,sha256,body,byte_length,content_type,redaction_version,metadata) VALUES($1,'manifest',$2,$3,$4,$5,'application/json','credential-free-bundle-v1',$6)",
      [
        id,
        batch,
        createHash("sha256").update(bytes).digest("hex"),
        bytes,
        bytes.byteLength,
        JSON.stringify(metadata),
      ],
    );
  };
  const legacyBundle = randomUUID();
  const legacyExtraction = randomUUID();
  const cycleLeft = randomUUID();
  const cycleRight = randomUUID();
  const metadataOnly = randomUUID();
  const unrelatedProfile = randomUUID();
  const unrelatedBundle = randomUUID();
  const unrelatedLeft = randomUUID();
  const unrelatedRight = randomUUID();
  const unrelatedBytes = Buffer.from("unrelated profile");
  await db.query(
    "INSERT INTO enrichment_artifacts(id,kind,import_batch,sha256,body,byte_length,content_type,redaction_version,metadata) VALUES($1,'legacy_import',$2,$3,$4,$5,'text/plain','none','{}')",
    [
      unrelatedProfile,
      "unrelated-profile",
      createHash("sha256").update(unrelatedBytes).digest("hex"),
      unrelatedBytes,
      unrelatedBytes.byteLength,
    ],
  );
  await insertManifest(
    legacyBundle,
    "legacy-source-bundle",
    {
      version: "profile-website-bundle-v1",
      profileArtifactId: profileId,
      website: {
        status: "captured",
        artifactId: websiteId,
        url: "https://retained.example/product",
      },
    },
    { purpose: "worker_source_bundle", entityId: founder, generation: 0 },
  );
  await insertManifest(
    legacyExtraction,
    "legacy-extraction",
    {
      version: "profile-website-evidence-v1",
      evidenceIds: [randomUUID()],
      artifactIds: [websiteId],
      website: {
        status: "captured",
        artifactId: websiteId,
        url: "https://retained.example/product",
      },
    },
    { purpose: "worker_extraction", entityId: founder, generation: 0 },
  );
  await insertManifest(
    cycleLeft,
    "cycle-left",
    {
      version: "profile-website-bundle-v1",
      profileArtifactId: profileId,
      website: {
        status: "captured",
        artifactId: cycleRight,
        url: "https://retained.example/cycle",
      },
    },
    { purpose: "worker_source_bundle" },
  );
  await insertManifest(
    cycleRight,
    "cycle-right",
    {
      version: "profile-website-bundle-v1",
      profileArtifactId: cycleLeft,
      website: {
        status: "captured",
        artifactId: websiteId,
        url: "https://retained.example/cycle-back",
      },
    },
    { purpose: "worker_source_bundle" },
  );
  await insertManifest(
    metadataOnly,
    "metadata-only",
    {
      version: "profile-website-bundle-v1",
      profileArtifactId: unrelatedProfile,
      website: {
        status: "unavailable",
        url: "https://retained.example/metadata",
      },
    },
    {
      purpose: "worker_source_bundle",
      sourceArtifactIds: [profileId],
    },
  );
  await insertManifest(
    unrelatedBundle,
    "unrelated-bundle",
    {
      version: "profile-website-bundle-v1",
      profileArtifactId: unrelatedProfile,
      website: {
        status: "unavailable",
        url: "https://other.example/keep",
      },
    },
    { purpose: "worker_source_bundle" },
  );
  await insertManifest(
    unrelatedLeft,
    "unrelated-cycle-left",
    {
      version: "profile-website-bundle-v1",
      profileArtifactId: unrelatedRight,
      website: { status: "unavailable", url: "https://other.example/cycle" },
    },
    { purpose: "worker_source_bundle" },
  );
  await insertManifest(
    unrelatedRight,
    "unrelated-cycle-right",
    {
      version: "profile-website-bundle-v1",
      profileArtifactId: unrelatedLeft,
      website: {
        status: "unavailable",
        url: "https://other.example/cycle-back",
      },
    },
    { purpose: "worker_source_bundle" },
  );
  const unrelatedRequest = await store.planCollection({
    scope: "other",
    fingerprint: "unrelated-retention",
    generation: 0,
    operation: "website",
    args: { url: "https://other.example/keep" },
    policyId: "synthetic",
  });
  const unrelatedAttempt = await store.reserveAttempt({
    requestId: unrelatedRequest.id,
    budgetId: unrelatedBudgetId,
    capMicros: "7",
  });
  await store.markDispatched(unrelatedAttempt.id);
  const unrelatedCapture = await store.captureResponse({
    attemptId: unrelatedAttempt.id,
    body: Buffer.from("unrelated website"),
    contentType: "text/plain",
    redactionVersion: "none",
    paymentState: "settled",
    settledMicros: "7",
    metadata: { sourceProfileArtifactId: unrelatedProfile },
  });
  const committedBefore = (
    await db.query<{ committed_micros: string }>(
      "SELECT committed_micros::text FROM enrichment_budgets WHERE id=$1",
      [budgetId],
    )
  ).rows[0].committed_micros;
  await store.withdrawArtifact(profileId, "test", "profile withdrawn");
  const purged = [
    profileId,
    websiteId,
    sourceBundle.id,
    extraction.id,
    legacyBundle,
    legacyExtraction,
    cycleLeft,
    cycleRight,
    metadataOnly,
  ];
  for (const id of purged) {
    assert.equal(await store.getArtifact(id), null, id);
    const row = (
      await db.query<{ bytes: number; metadata: unknown }>(
        "SELECT octet_length(body)::integer AS bytes, metadata FROM enrichment_artifacts WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.bytes, 0, id);
    assert.deepEqual(row.metadata, {}, id);
  }
  assert.equal(
    (
      await db.query<{ excerpt: string; source_url: string | null }>(
        "SELECT excerpt, source_url FROM enrichment_evidence WHERE artifact_id=$1",
        [websiteId],
      )
    ).rows[0].excerpt,
    "",
  );
  for (const id of [
    unrelatedProfile,
    unrelatedBundle,
    unrelatedLeft,
    unrelatedRight,
    unrelatedCapture.id,
  ]) {
    const artifact = await store.getArtifact(id);
    assert.ok(artifact, id);
    assert.ok(artifact.body.byteLength > 0, id);
  }
  assert.match(
    Buffer.from((await store.getArtifact(unrelatedBundle))!.body).toString(),
    /https:\/\/other\.example\/keep/,
  );
  assert.equal(
    (
      await db.query<{ committed_micros: string }>(
        "SELECT committed_micros::text FROM enrichment_budgets WHERE id=$1",
        [budgetId],
      )
    ).rows[0].committed_micros,
    committedBefore,
  );
  assert.equal(
    (
      await db.query<{ committed_micros: string }>(
        "SELECT committed_micros::text FROM enrichment_budgets WHERE id=$1",
        [unrelatedBudgetId],
      )
    ).rows[0].committed_micros,
    "7",
  );
  assert.deepEqual(
    (
      await db.query<{ args: unknown }>(
        "SELECT args FROM enrichment_collection_requests WHERE id=$1",
        [unrelatedRequest.id],
      )
    ).rows[0].args,
    { url: "https://other.example/keep" },
  );
  const stages = (
    await db.query<{ stage: string; status: string }>(
      "SELECT stage,status FROM enrichment_stage_work WHERE entity_id=$1",
      [founder],
    )
  ).rows;
  assert.equal(
    stages.find((row) => row.stage === "collection")?.status,
    "blocked",
  );
  assert.equal(
    stages.find((row) => row.stage === "extraction")?.status,
    "blocked",
  );
  await pg.close();
});
