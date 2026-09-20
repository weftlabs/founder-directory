import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../scripts/founder-dna-prepare";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  migrateEnrichment,
  type Database,
  type Sql,
} from "../lib/enrichment/db";
import { EnrichmentStore } from "../lib/enrichment/store";
import { DnaPublicationStore } from "../lib/enrichment/dna-store";
import {
  parsePreparationManifest,
  type PreparationManifest,
} from "../lib/enrichment/dna-prepare";
import { readFounderDnaProfile } from "../lib/founder-dna-data";
import { founderDnaFixture } from "./fixtures/founder-dna";
import { MODEL, type Request } from "../lib/typesafe-poc";

test("preparation and connections require explicit writes before opening a database", async () => {
  for (const command of ["prepare", "connections-plan", "connections"])
    await assert.rejects(
      main([command]),
      /explicit_write_confirmation_required/,
    );
});

test("manifest rejects display JSON, duplicate owners and unbounded cohorts", () => {
  const profile = {
    entityId: randomUUID(),
    analysisId: randomUUID(),
    portraitAnalysisId: randomUUID(),
  };
  const manifest = {
    version: 1,
    releaseId: "pilot",
    scope: "pilot",
    profiles: [profile],
  };
  assert.equal(parsePreparationManifest(manifest).profiles.length, 1);
  for (const invalid of [
    { ...manifest, profiles: [] },
    { ...manifest, profiles: Array(1001).fill(profile) },
    { ...manifest, profiles: [profile, profile] },
    { ...manifest, profiles: [{ ...profile, profile: founderDnaFixture() }] },
    { ...manifest, profiles: [{ ...profile, analysisId: "not-a-uuid" }] },
    { ...manifest, version: 2 },
  ])
    assert.throws(() => parsePreparationManifest(invalid));
});

test("database fallback and paid env alone cannot authorize the command", async () => {
  let connected = false;
  const connect = () => {
    connected = true;
    throw new Error("unexpected_connection");
  };
  await assert.rejects(
    main(["prepare", "--confirm-write"], {
      env: { DATABASE_URL: "postgres://unused" },
      connect,
    }),
    /explicit_database_url_required/,
  );
  await assert.rejects(
    main(["connections", "--confirm-write", "--mode", "acquire"], {
      env: { ENRICHMENT_ALLOW_PAID: "1", TYPESAFE_AI_API_KEY: "fixture" },
      connect,
    }),
    /paid_connections_not_enabled/,
  );
  assert.equal(connected, false);
});

test("default command wiring stages retained portraits, captures paid mock decisions and replays without network", async () => {
  const pg = new PGlite();
  const directory = await mkdtemp(join(tmpdir(), "dna-prepare-test-"));
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
  const store = new EnrichmentStore(db),
    dna = new DnaPublicationStore(db);
  const scope = "synthetic-prepare",
    releaseId = "synthetic-source-release",
    budgetId = randomUUID();
  const manifest: PreparationManifest = {
    version: 1,
    releaseId,
    scope,
    profiles: [],
  };
  const rawIds: string[] = [];
  const policy = {
    id: "synthetic-jev",
    scope,
    operation: "typesafe-systemone",
    storageVerified: true,
    retentionApproved: true,
  };
  let opened = 0,
    closed = 0,
    dispatches = 0;
  const output: string[] = [];
  const dependencies = {
    env: {
      ENRICHMENT_DATABASE_URL: "postgres://explicit-test-only",
      ENRICHMENT_ALLOW_PAID: "1",
      TYPESAFE_AI_API_KEY: "fixture-key",
    },
    connect: (url: string) => {
      opened++;
      assert.equal(url, "postgres://explicit-test-only");
      return {
        ...db,
        close: async () => {
          closed++;
        },
      };
    },
    output: (text: string) => {
      output.push(text);
    },
    fetcher: (async (_url, init) => {
      dispatches++;
      const request = JSON.parse(String(init?.body)) as Request;
      const keys = Object.keys(request.questions.related_work.criteria);
      return new Response(
        JSON.stringify({
          model: MODEL,
          usage: { input_tokens: 100, output_tokens: 10 },
          answers: {
            related_work: {
              type: "choice",
              choice: "scheduling",
              confidence: 0.99,
              probabilities: Object.fromEntries(
                keys.map((key) => [
                  key,
                  key === "scheduling" ? 0.99 : 0.01 / (keys.length - 1),
                ]),
              ),
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  };
  const file = join(directory, "cohort.json"),
    policyFile = join(directory, "policy.json"),
    batchFile = join(directory, "connection-batches.json");
  const prepare = [
    "prepare",
    "--database-url",
    "postgres://explicit-test-only",
    "--file",
    file,
    "--confirm-write",
  ];
  const connections = [
    "connections",
    "--database-url",
    "postgres://explicit-test-only",
    "--release",
    releaseId,
    "--scope",
    scope,
    "--policy",
    policyFile,
    "--budget",
    budgetId,
    "--jev-cap-micros",
    "10000",
    "--max-requests",
    "3",
    "--confirm-write",
  ];
  const connectionsPlan = [
    "connections-plan",
    "--database-url",
    "postgres://explicit-test-only",
    "--release",
    releaseId,
    "--scope",
    scope,
    "--file",
    batchFile,
    "--confirm-write",
  ];
  const count = async (table: string) =>
    (
      await db.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM ${table}`,
      )
    ).rows[0].count;
  try {
    await migrateEnrichment(db);
    await store.createBudget({
      id: budgetId,
      scope,
      currency: "USD",
      capMicros: "30000",
    });
    for (const handle of ["example", "second_example", "third_example"]) {
      const entityId = await store.createEntity("founder", handle);
      const raw = await store.putArtifact({
        kind: "legacy_import",
        body: Buffer.from(`${handle} builds scheduling tools.`),
        contentType: "text/plain",
        redactionVersion: "none",
        importBatch: "synthetic",
      });
      rawIds.push(raw.id);
      const evidenceId = await store.addEvidence({
        artifactId: raw.id,
        extractorVersion: "v1",
        locator: "bio",
        excerpt: `${handle} builds scheduling tools.`,
        payload: {},
        sourceUrl: `https://example.com/${handle}`,
      });
      await store.linkEvidence(entityId, evidenceId, "bio");
      const executionRelease = await store.createRelease({
        stages: ["founder_dna"],
        fixture: handle,
      });
      await store.approveRelease(executionRelease, raw.id, {
        actor: "fixture-reviewer",
        reason: "synthetic",
      });
      const analysisId = randomUUID(),
        portraitAnalysisId = randomUUID();
      const profile = founderDnaFixture();
      Object.assign(profile, { id: entityId, handle, analysisId });
      profile.portrait.analysisId = portraitAnalysisId;
      profile.sources[0].id = evidenceId;
      profile.facts[0].sourceIds = [evidenceId];
      for (const [id, purpose, output] of [
        [analysisId, "founder_dna", {}],
        [portraitAnalysisId, "founder_portrait", { profile }],
      ] as const)
        await store.saveAnalysis({
          id,
          entityId,
          releaseId: executionRelease,
          generation: 0,
          purpose,
          inputArtifactId: raw.id,
          inputDigest: "input",
          recipeDigest: "recipe",
          evidenceIds: [evidenceId],
          output,
          validationReport: {
            checksPassed: true,
            generationResponseArtifactId: raw.id,
            judgeRequestArtifactId: raw.id,
            judgeResponseArtifactId: raw.id,
            productAnalysisIds: [],
          },
          status: "succeeded",
        });
      const embedding = await store.saveEmbedding({
        scope,
        text: "Scheduling",
        templateVersion: "v1",
        model: "fixture-local",
        modelVersion: "v1",
        distance: "cosine",
        vector: [1, 0],
      });
      await store.linkEmbedding(entityId, analysisId, embedding, "founder_dna");
      manifest.profiles.push({ entityId, analysisId, portraitAnalysisId });
    }
    await writeFile(file, JSON.stringify(manifest));
    await writeFile(policyFile, JSON.stringify(policy));
    await assert.rejects(main(prepare, dependencies), /portrait_not_approved/);
    assert.equal(await count("founder_dna_portrait_publications"), 0);
    assert.equal(await count("founder_dna_release_profiles"), 0);
    for (const profile of manifest.profiles)
      await dna.approvePortrait(
        profile.entityId,
        profile.portraitAnalysisId,
        "fixture-reviewer",
      );
    await main(prepare, dependencies);
    await main(prepare, dependencies);
    assert.equal(await count("founder_dna_release_profiles"), 3);
    assert.deepEqual(JSON.parse(output.at(-1)!), {
      releaseId,
      stagedProfiles: 3,
    });
    assert.deepEqual(await readFounderDnaProfile(db, "example"), {
      status: "not_found",
    });
    assert.equal(dispatches, 0);
    await main(connectionsPlan, dependencies);
    const batchPlan = JSON.parse(await readFile(batchFile, "utf8")) as {
      candidateCount: number;
      batches: { id: string; pairIds: string[] }[];
    };
    assert.equal(batchPlan.candidateCount, 3);
    assert.equal(batchPlan.batches.length, 1);
    assert.equal(batchPlan.batches[0].pairIds.length, 3);
    await assert.rejects(main(connectionsPlan, dependencies), /EEXIST/);
    const selectedBatch = [
      "--batch-file",
      batchFile,
      "--batch",
      batchPlan.batches[0].id,
    ];
    // Default is replay even if paid credentials are present.
    await assert.rejects(main(connections, dependencies), /missing_input/);
    assert.equal(dispatches, 0);
    assert.equal(await count("enrichment_collection_attempts"), 0);
    const tooFew = [...connections];
    tooFew[tooFew.indexOf("--max-requests") + 1] = "1";
    await assert.rejects(
      main(
        [...tooFew, ...selectedBatch, "--mode", "acquire", "--allow-paid"],
        dependencies,
      ),
      /request_limit_exceeded/,
    );
    assert.equal(dispatches, 0);
    await db.query("UPDATE enrichment_budgets SET scope='wrong' WHERE id=$1", [
      budgetId,
    ]);
    await assert.rejects(
      main(connections, dependencies),
      /budget_scope_mismatch/,
    );
    await db.query("UPDATE enrichment_budgets SET scope=$2 WHERE id=$1", [
      budgetId,
      scope,
    ]);
    await main(
      [...connections, ...selectedBatch, "--mode", "acquire", "--allow-paid"],
      dependencies,
    );
    assert.equal(dispatches, 3);
    assert.deepEqual(JSON.parse(output.at(-1)!), {
      candidatePairs: 3,
      processedPairs: 3,
      accepted: 3,
      rejected: 0,
      insufficient: 0,
      staged: 0,
    });
    assert.equal(await count("founder_dna_connection_decisions"), 3);
    assert.equal(await count("founder_dna_release_edges"), 0);
    assert.equal(await count("enrichment_collection_attempts"), 3);
    await main(
      [...connections, ...selectedBatch, "--mode", "acquire", "--allow-paid"],
      dependencies,
    );
    assert.equal(
      dispatches,
      3,
      "a resumed batch reuses every retained decision",
    );
    await db.query(
      "UPDATE enrichment_embeddings SET vector=ARRAY[2::double precision,0::double precision]",
    );
    await assert.rejects(
      main([...connections, "--batch-file", batchFile], {
        ...dependencies,
        env: { ENRICHMENT_DATABASE_URL: "postgres://explicit-test-only" },
        fetcher: async () => {
          throw new Error("replay_must_not_dispatch");
        },
      }),
      /connection_batch_manifest_mismatch/,
    );
    assert.equal(await count("founder_dna_release_edges"), 0);
    await db.query(
      "UPDATE enrichment_embeddings SET vector=ARRAY[1::double precision,0::double precision]",
    );
    await main([...connections, "--batch-file", batchFile], {
      ...dependencies,
      env: { ENRICHMENT_DATABASE_URL: "postgres://explicit-test-only" },
      fetcher: async () => {
        throw new Error("replay_must_not_dispatch");
      },
    });
    assert.equal(await count("enrichment_collection_attempts"), 3);
    assert.equal(await count("founder_dna_release_edges"), 3);
    const status = (
      await db.query<{ status: string }>(
        "SELECT status FROM founder_dna_releases WHERE id=$1",
        [releaseId],
      )
    ).rows[0].status;
    assert.equal(status, "staging");
    assert.deepEqual(await readFounderDnaProfile(db, "example"), {
      status: "not_found",
    });
    await store.withdrawArtifact(
      rawIds[0],
      "fixture-reviewer",
      "source removed",
    );
    await main(connections, dependencies);
    assert.equal(JSON.parse(output.at(-1)!).candidatePairs, 1);
    assert.equal(dispatches, 3);
    await assert.rejects(dna.validateRelease(releaseId), /ineligible/);
    assert.equal(
      closed,
      opened,
      "each success and failure closes its database handle",
    );
  } finally {
    await pg.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("unknown commands and acquire without paid permission fail before connecting", async () => {
  await assert.rejects(main(["activate"]), /unknown_command/);
  await assert.rejects(
    main(["connections", "--confirm-write", "--mode", "acquire"]),
    /paid_connections_not_enabled/,
  );
});
