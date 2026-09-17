import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  migrateEnrichment,
  type Database,
  type Sql,
} from "../lib/enrichment/db";
import { EnrichmentStore } from "../lib/enrichment/store";
import {
  installLegacyIntake,
  importLegacyIntake,
} from "../lib/enrichment/legacy";
import { runAnalysis } from "../lib/enrichment/analysis";
import { buildAnalysisInput } from "../lib/enrichment/recipes";
import { stableDigest } from "../lib/enrichment/contracts";
import { collectResponse } from "../lib/enrichment/collection";
import { capturedTransport } from "../lib/enrichment/runtime";
import { weftGeneration } from "../lib/enrichment/generation";
import { fetchProfile, searchIntroPage } from "../lib/x";
import { response } from "./fixtures";

test("zero-cap free capture is durable and closes as not charged; ambiguous money stays pending", async () => {
  const { pg, db, store } = await fixture();
  try {
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "0",
    });
    for (const [generation, heldUsd] of ["0", "0.001"].entries()) {
      await collectResponse(
        store,
        {
          scope: "test",
          budgetId,
          generation,
          mode: "acquire",
          operation: "free-fixture",
          args: {},
          capMicros: "0",
          policy: {
            id: "fixture",
            scope: "test",
            operation: "free-fixture",
            storageVerified: true,
            retentionApproved: true,
          },
        },
        async () => ({
          body: Buffer.from("source"),
          status: 200,
          contentType: "text/plain",
          paymentStatus: "not_required",
          paidUsd: "0",
          heldUsd,
        }),
      );
    }
    const rows = (
      await db.query<{ payment_state: string }>(
        "SELECT payment_state FROM enrichment_collection_attempts",
      )
    ).rows;
    assert.deepEqual(rows.map((row) => row.payment_state).sort(), [
      "not_charged",
      "pending",
    ]);
  } finally {
    await pg.close();
  }
});

test("model HTTP failures remain archived and cannot enter output validation", async () => {
  const { pg, db, store } = await fixture();
  try {
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "10000",
    });
    const execute = weftGeneration(
      store,
      { fetch: async () => response(500, { claims: [] }) },
      {
        scope: "test",
        budgetId,
        maxCostUsd: "0.001",
        enabled: () => true,
        policy: {
          id: "fixture",
          scope: "test",
          operation: "openrouter-chat-completions",
          storageVerified: true,
          retentionApproved: true,
        },
      },
    );
    const input = buildAnalysisInput({
      entityId: "fixture",
      releaseId: "fixture",
      generation: 0,
      purpose: "founder_dna",
      evidence: [],
      model: { provider: "weft/openrouter", model: "fixture", revision: "1" },
      codeDigest: "fixture",
    });
    await assert.rejects(
      execute({
        runId: randomUUID(),
        requestBytes: new Uint8Array(),
        request: {
          recipe: input.recipe,
          messages: input.messages,
          context: [],
          evidence: [],
        },
      }),
      /model_http_failure_response_archived/,
    );
    const saved = await db.query<{ body: Uint8Array }>(
      "SELECT body FROM enrichment_artifacts WHERE attempt_id IS NOT NULL",
    );
    assert.equal(saved.rows.length, 1);
    assert.deepEqual(JSON.parse(Buffer.from(saved.rows[0].body).toString()), {
      claims: [],
    });
  } finally {
    await pg.close();
  }
});

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
  await db.query(
    "CREATE TABLE founders(handle text PRIMARY KEY,name text,bio text,intro_text text,intro_url text)",
  );
  await db.query(
    "INSERT INTO founders VALUES('fixture_old','Old Fixture','Builds tools','I am a founder','https://x.com/fixture_old/status/123')",
  );
  await migrateEnrichment(db);
  await installLegacyIntake(db);
  await installLegacyIntake(db);
  const store = new EnrichmentStore(db);
  const evaluation = await store.putArtifact({
    kind: "legacy_import",
    body: Buffer.from("synthetic evaluation only"),
    contentType: "text/plain",
    redactionVersion: "none",
    importBatch: "test-evaluation",
  });
  const recipe = buildAnalysisInput({
    entityId: "recipe",
    releaseId: "recipe",
    generation: 0,
    purpose: "founder_dna",
    evidence: [],
    model: { provider: "synthetic", model: "fixture", revision: "1" },
    codeDigest: "test",
  }).recipe;
  const release = await store.createRelease({
    stages: ["collection", "extraction", "founder_dna"],
    recipes: { founder_dna: stableDigest(recipe) },
  });
  await store.approveRelease(release, evaluation.id, {
    actor: "test",
    reason: "synthetic test only",
  });
  await store.promoteRelease("test", release, "test");
  return { pg, db, store, release };
}

test("legacy backfill and future founder insertion share durable intake and preserve original post", async () => {
  const { pg, db } = await fixture();
  try {
    assert.deepEqual(await importLegacyIntake(db, "test"), { imported: 1 });
    await db.query(
      "INSERT INTO founders VALUES('fixture_new','New Fixture','Builds tools','I am a builder','https://x.com/fixture_new/status/456')",
    );
    await db.query(
      "UPDATE founders SET intro_text='replacement',intro_url='https://x.com/fixture_new/status/999' WHERE handle='fixture_new'",
    );
    assert.deepEqual(await importLegacyIntake(db, "test"), { imported: 1 });
    assert.deepEqual(await importLegacyIntake(db, "test"), { imported: 0 });
    const rows = await db.query<{
      legacy_key: string;
      status: string;
      source_url: string;
    }>(
      "SELECT e.legacy_key,o.status,v.source_url FROM enrichment_entities e JOIN enrichment_index_origins o ON o.founder_id=e.id JOIN enrichment_evidence v ON v.id=o.evidence_id ORDER BY e.legacy_key",
    );
    assert.deepEqual(
      rows.rows.map((row) => [row.legacy_key, row.status, row.source_url]),
      [
        ["fixture_new", "confirmed", "https://x.com/fixture_new/status/456"],
        [
          "fixture_old",
          "legacy-unverified",
          "https://x.com/fixture_old/status/123",
        ],
      ],
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM enrichment_stage_work",
        )
      ).rows[0].count,
      6,
    );
  } finally {
    await pg.close();
  }
});

test("saved evidence produces durable analysis, unchanged input reuses, changed prompt re-derives without source calls", async () => {
  const { pg, db, store, release } = await fixture();
  try {
    await importLegacyIntake(db, "test");
    const row = (
      await db.query<{
        entity_id: string;
        id: string;
        artifact_id: string;
        excerpt: string;
        source_url: string;
      }>(
        "SELECT ee.entity_id,e.id,e.artifact_id,e.excerpt,e.source_url FROM enrichment_evidence e JOIN enrichment_entity_evidence ee ON ee.evidence_id=e.id",
      )
    ).rows[0];
    const input = buildAnalysisInput({
      entityId: row.entity_id,
      releaseId: release,
      generation: 0,
      purpose: "founder_dna",
      evidence: [
        {
          id: row.id,
          artifactId: row.artifact_id,
          text: row.excerpt,
          contentHash: stableDigest(row.excerpt),
          sourceUrl: row.source_url,
          extractorVersion: "founder-row-v1",
        },
      ],
      model: { provider: "synthetic", model: "fixture", revision: "1" },
      codeDigest: "test",
    });
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "100",
    });
    let modelCalls = 0;
    const execute = async ({ runId }: { runId: string }) => {
      const body = JSON.stringify({
        schemaVersion: "claims-v1",
        claims: ["summary", "craft", "working_style", "interests"].map(
          (field) => ({
            field,
            value: null,
            kind: "inference",
            state: "unknown",
            evidenceIds: [],
          }),
        ),
      });
      const artifact = await collectResponse(
        store,
        {
          scope: "test",
          operation: "fixture-generation",
          args: { runId },
          generation: 0,
          budgetId,
          capMicros: "10",
          mode: "acquire",
          policy: {
            id: "fixture",
            scope: "test",
            operation: "fixture-generation",
            storageVerified: true,
            retentionApproved: true,
          },
        },
        async () => {
          modelCalls++;
          return {
            body: Buffer.from(body),
            status: 200,
            contentType: "application/json",
            paymentStatus: "settled",
            paidUsd: "0.000010",
          };
        },
      );
      return {
        attemptId: String(artifact.metadata.attemptId),
        rawResponse: body,
        responseArtifactId: artifact.id,
        usage: null,
        finishReason: "stop",
      };
    };
    const first = await runAnalysis(store, input, execute);
    assert.equal(first.status, "succeeded");
    assert.equal(
      (await runAnalysis(new EnrichmentStore(db), input, execute)).status,
      "reused",
    );
    const changedRecipe = { ...input.recipe, promptVersion: "changed-v2" };
    const nextRelease = await store.createRelease({
      stages: ["collection", "extraction", "founder_dna"],
      recipes: { founder_dna: stableDigest(changedRecipe) },
    });
    const evaluation = await store.putArtifact({
      kind: "legacy_import",
      body: Buffer.from("new synthetic evaluation"),
      contentType: "text/plain",
      redactionVersion: "none",
      importBatch: "test-next-evaluation",
    });
    await store.approveRelease(nextRelease, evaluation.id, {
      actor: "test",
      reason: "fixture candidate evaluated",
    });
    await store.promoteRelease("test", nextRelease, "candidate upgrade");
    await store.reconcileTargets("test");
    const changed = await runAnalysis(
      store,
      { ...input, releaseId: nextRelease, recipe: changedRecipe },
      execute,
    );
    assert.equal(changed.status, "succeeded");
    assert.equal(modelCalls, 2);
    assert.notEqual(first.runId, changed.runId);
    assert.equal(await store.publishAnalysis(changed.runId), true);
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM enrichment_collection_requests WHERE operation <> 'fixture-generation'",
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await pg.close();
  }
});

test("intake migration cannot silently finish before the directory schema exists", async () => {
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
  try {
    await migrateEnrichment(db);
    await assert.rejects(installLegacyIntake(db), /founders_schema_required/);
    assert.equal(
      (
        await db.query(
          "SELECT version FROM enrichment_migrations WHERE version=2",
        )
      ).rows.length,
      0,
    );
    await db.query("CREATE TABLE founders(handle text PRIMARY KEY,name text)");
    await installLegacyIntake(db);
    await db.query(
      "INSERT INTO founders VALUES('fixture_late','Late Fixture')",
    );
    assert.equal(
      (await db.query("SELECT founder_key FROM enrichment_founder_intake")).rows
        .length,
      1,
    );
  } finally {
    await pg.close();
  }
});

test("real source adapter archives malformed raw data before it rejects parsing", async () => {
  const { pg, db, store } = await fixture();
  try {
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "20000",
    });
    let calls = 0;
    const client = capturedTransport(
      store,
      {
        fetch: async () => {
          calls++;
          return {
            ...response(200),
            bodyBase64: Buffer.from("malformed raw source").toString("base64"),
          };
        },
      },
      {
        scope: "test",
        budgetId,
        generation: 0,
        policies: Object.fromEntries(
          ["bazaar-x402-atlas-183", "bazaar-x402-atlas-177"].map(
            (operation) => [
              operation,
              {
                id: "fixture",
                scope: "test",
                operation,
                storageVerified: true,
                retentionApproved: true,
              },
            ],
          ),
        ),
      },
      () => true,
    );
    const deps = { apiKey: () => "synthetic", createClient: () => client };
    assert.equal(await fetchProfile("fixture", "intro", "123", deps), null);
    await assert.rejects(
      searchIntroPage("keep-this-cursor", deps),
      /Invalid provider JSON|provider|JSON/i,
    );
    assert.equal(calls, 2);
    const saved = await db.query<{ body: Uint8Array }>(
      "SELECT body FROM enrichment_artifacts WHERE kind='source_response'",
    );
    assert.equal(saved.rows.length, 2);
    assert.ok(
      saved.rows.every(
        (row) => Buffer.from(row.body).toString() === "malformed raw source",
      ),
    );
  } finally {
    await pg.close();
  }
});
