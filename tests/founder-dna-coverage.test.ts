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
import { DnaPublicationStore } from "../lib/enrichment/dna-store";
import {
  DNA_RELEASE_PROFILE_LIMIT,
  readFounderDnaCoverage,
} from "../lib/enrichment/dna-coverage";
import { founderDnaFixture } from "./fixtures/founder-dna";
import { main as releaseMain } from "../scripts/founder-dna-release";

function database(includeDirectory = true) {
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
  return { pg, db, includeDirectory };
}
async function migrated(includeDirectory = true) {
  const opened = database(includeDirectory);
  await migrateEnrichment(opened.db);
  if (includeDirectory)
    await opened.db.query("CREATE TABLE founders(handle text PRIMARY KEY)");
  return opened;
}
async function stageReady(db: Database, handle: string, releaseId: string) {
  const store = new EnrichmentStore(db);
  const dna = new DnaPublicationStore(db);
  const entity = await store.createEntity("founder", handle);
  const raw = await store.putArtifact({
    kind: "legacy_import",
    body: Buffer.from("Designer"),
    contentType: "text/plain",
    redactionVersion: "none",
    importBatch: `synthetic-${handle}`,
  });
  const evidence = await store.addEvidence({
    artifactId: raw.id,
    extractorVersion: "v1",
    locator: "bio",
    excerpt: "Designer",
    payload: {},
    sourceUrl: "https://example.com/alex",
  });
  await store.linkEvidence(entity, evidence, "bio");
  const execution = await store.createRelease({ stages: ["founder_dna"] });
  await store.approveRelease(execution, raw.id, {
    actor: "test",
    reason: "synthetic",
  });
  const analysis = randomUUID();
  const portrait = randomUUID();
  const profile = founderDnaFixture();
  profile.id = entity;
  profile.handle = handle;
  profile.analysisId = analysis;
  profile.portrait.analysisId = portrait;
  profile.sources[0].id = evidence;
  profile.facts[0].sourceIds = [evidence];
  for (const [id, purpose, output] of [
    [analysis, "founder_dna", {}],
    [portrait, "founder_portrait", { profile }],
  ] as const)
    await store.saveAnalysis({
      id,
      entityId: entity,
      releaseId: execution,
      generation: 0,
      purpose,
      inputArtifactId: raw.id,
      inputDigest: `input-${handle}`,
      recipeDigest: "recipe",
      evidenceIds: [evidence],
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
  await dna.approvePortrait(entity, portrait, "reviewer");
  await dna.createRelease({
    id: releaseId,
    manifest: { cohort: [entity] },
    expectedProfiles: 1,
  });
  await dna.stageProfile({
    releaseId,
    entityId: entity,
    analysisId: analysis,
    portraitAnalysisId: portrait,
  });
  return { store, dna, entity, raw, evidence, analysis, portrait };
}
async function publishProduct(
  store: EnrichmentStore,
  founderId: string,
  relationshipEvidenceId: string,
) {
  const product = await store.createEntity("product", `product-${founderId}`);
  const raw = await store.putArtifact({
    kind: "legacy_import",
    body: Buffer.from("Product"),
    contentType: "text/plain",
    redactionVersion: "none",
    importBatch: `product-${founderId}`,
  });
  const evidence = await store.addEvidence({
    artifactId: raw.id,
    extractorVersion: "v1",
    locator: "page",
    excerpt: "Product",
    payload: { sourceKind: "product-site" },
    sourceUrl: "https://example.test/product",
  });
  await store.linkEvidence(product, evidence, "source");
  await store.linkProduct(founderId, product, relationshipEvidenceId);
  const release = await store.createRelease({
    stages: ["product_descriptions"],
  });
  await store.approveRelease(release, raw.id, {
    actor: "test",
    reason: "synthetic",
  });
  const analysis = randomUUID();
  await store.saveAnalysis({
    id: analysis,
    entityId: product,
    releaseId: release,
    generation: 0,
    purpose: "product_descriptions",
    inputArtifactId: raw.id,
    inputDigest: `product-${founderId}`,
    recipeDigest: "product-recipe",
    evidenceIds: [evidence],
    output: { claims: [] },
    validationReport: {},
    status: "succeeded",
  });
  await store.db.query(
    "INSERT INTO enrichment_profiles(entity_id,analysis_id) VALUES($1,$2)",
    [product, analysis],
  );
  return { raw };
}
async function activeRelease(db: Sql) {
  return (
    (
      await db.query<{ release_id: string }>(
        "SELECT release_id FROM founder_dna_active_release",
      )
    ).rows[0]?.release_id ?? null
  );
}

test("coverage separates directory, product and shared gaps without hiding founders", async () => {
  const { pg, db } = await migrated();
  try {
    const ready = await stageReady(db, "covered", "pilot");
    await ready.store.createEntity("founder", "prodonly");
    const productFounder = (
      await db.query<{ id: string }>(
        "SELECT id FROM enrichment_entities WHERE legacy_key='prodonly'",
      )
    ).rows[0].id;
    const productEvidence = await ready.store.addEvidence({
      artifactId: ready.raw.id,
      extractorVersion: "v1",
      locator: "ownership",
      excerpt: "Linked",
      payload: {},
    });
    await ready.store.linkEvidence(
      productFounder,
      productEvidence,
      "ownership",
    );
    await publishProduct(ready.store, productFounder, productEvidence);
    const shared = await ready.store.createEntity("founder", "shared");
    const sharedEvidence = await ready.store.addEvidence({
      artifactId: ready.raw.id,
      extractorVersion: "v1",
      locator: "shared",
      excerpt: "Shared link",
      payload: {},
    });
    await ready.store.linkEvidence(shared, sharedEvidence, "ownership");
    await publishProduct(ready.store, shared, sharedEvidence);
    await db.query(
      "INSERT INTO founders(handle) VALUES ('dironly'),('Shared'),('not a handle'),('hidden')",
    );
    const hidden = await ready.store.createEntity("founder", "hidden");
    await ready.store.suppressEntity(hidden, "synthetic suppression");
    const report = await readFounderDnaCoverage(db, "pilot");
    assert.equal(report.directory.total, 3);
    assert.equal(report.directory.missing, 3);
    assert.equal(report.productLinked.total, 2);
    assert.equal(report.productLinked.missing, 2);
    assert.equal(report.union.total, 4);
    assert.equal(report.union.missing, 4);
    const invalid = report.missing.find(
      (gap) => gap.reason === "invalid_handle",
    );
    assert.ok(invalid);
    assert.match(invalid.handle, /^invalid:[0-9a-f]{12}$/);
    assert.deepEqual(
      report.missing
        .map((gap) => [gap.handle, gap.sources, gap.reason])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        ["dironly", ["directory"], "no_founder_entity"],
        [invalid.handle, ["directory"], "invalid_handle"],
        ["prodonly", ["product"], "not_in_release"],
        ["shared", ["directory", "product"], "not_in_release"],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    assert.equal(JSON.stringify(report).includes("not a handle"), false);
    assert.equal(JSON.stringify(report).includes("Designer"), false);
    assert.equal(JSON.stringify(report).includes("hidden"), false);
    await ready.dna.validateRelease("pilot");
    await assert.rejects(
      ready.dna.activateRelease("pilot"),
      /dna_coverage_incomplete/,
    );
    assert.equal(await activeRelease(db), null);
  } finally {
    await pg.close();
  }
});

test("eligible public union activates and withdrawal or later intake blocks the pointer change", async () => {
  const { pg, db } = await migrated();
  try {
    const first = await stageReady(db, "ready", "first");
    await db.query("INSERT INTO founders(handle) VALUES ('ready')");
    await publishProduct(first.store, first.entity, first.evidence);
    await first.dna.validateRelease("first");
    const before = await readFounderDnaCoverage(db, "first");
    assert.equal(before.union.missing, 0);
    assert.equal(before.directory.ready, 1);
    assert.equal(before.productLinked.ready, 1);
    assert.equal(before.union.total, 1);
    await first.dna.activateRelease("first");
    assert.equal(await activeRelease(db), "first");
    await first.dna.createRelease({
      id: "second",
      manifest: { cohort: [first.entity] },
      expectedProfiles: 1,
    });
    await first.dna.stageProfile({
      releaseId: "second",
      entityId: first.entity,
      analysisId: first.analysis,
      portraitAnalysisId: first.portrait,
    });
    await first.dna.validateRelease("second");
    await first.dna.activateRelease("second");
    await db.query("INSERT INTO founders(handle) VALUES ('later')");
    await assert.rejects(first.dna.rollback(), /dna_coverage_incomplete/);
    assert.equal(await activeRelease(db), "second");
    await first.store.withdrawArtifact(first.raw.id, "test", "withdrawn");
    const withdrawn = await readFounderDnaCoverage(db, "second");
    assert.equal(
      withdrawn.missing.find((gap) => gap.handle === "ready")?.reason,
      "not_eligible",
    );
    await assert.rejects(
      first.dna.activateRelease("second"),
      /ineligible|dna_coverage_incomplete/,
    );
    assert.equal(await activeRelease(db), "second");
  } finally {
    await pg.close();
  }
});

test("withdrawn product relationship is not a required founder link", async () => {
  const { pg, db } = await migrated();
  try {
    const ready = await stageReady(db, "ready", "pilot");
    await db.query("INSERT INTO founders(handle) VALUES ('ready')");
    const unrelated = await ready.store.createEntity("founder", "oldlink");
    const evidence = await ready.store.addEvidence({
      artifactId: ready.raw.id,
      extractorVersion: "v1",
      locator: "old",
      excerpt: "Old link",
      payload: {},
    });
    await ready.store.linkEvidence(unrelated, evidence, "ownership");
    const product = await publishProduct(ready.store, unrelated, evidence);
    await ready.store.withdrawArtifact(
      product.raw.id,
      "test",
      "withdrawn link",
    );
    await ready.dna.validateRelease("pilot");
    const report = await readFounderDnaCoverage(db, "pilot");
    assert.equal(report.productLinked.total, 0);
    assert.equal(report.union.missing, 0);
    await ready.dna.activateRelease("pilot");
    assert.equal(await activeRelease(db), "pilot");
  } finally {
    await pg.close();
  }
});

test("coverage report is read-only and fails closed without a directory schema", async () => {
  const opened = await migrated();
  const { pg, db } = opened;
  try {
    await stageReady(db, "ready", "pilot");
    const writes: string[] = [];
    const guarded: Sql = {
      async query<T>(sql: string, values?: unknown[]) {
        if (!/^\s*(select|with)\b/i.test(sql)) writes.push(sql);
        return db.query<T>(sql, values);
      },
    };
    const report = await readFounderDnaCoverage(guarded, "pilot");
    assert.equal(report.union.total, 0);
    assert.deepEqual(writes, []);
    let closed = false;
    const command = await releaseMain(
      [
        "coverage",
        "--database-url",
        "postgres://explicit-test-only",
        "--release",
        "pilot",
      ],
      {
        connect: (url) => {
          assert.equal(url, "postgres://explicit-test-only");
          return {
            ...db,
            close: async () => {
              closed = true;
            },
          };
        },
      },
    );
    assert.equal(command?.command, "coverage");
    if (command?.command !== "coverage") assert.fail("coverage command");
    assert.equal(command.union.missing, 0);
    assert.equal(closed, true);
    assert.equal(await activeRelease(db), null);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM founder_dna_releases"))
        .rows[0].n,
      1,
    );
    await assert.rejects(
      readFounderDnaCoverage(db, "missing"),
      /dna_coverage_release_not_found/,
    );
  } finally {
    await pg.close();
  }
  const bare = await migrated(false);
  try {
    await bare.db.query(
      "INSERT INTO founder_dna_releases(id,schema_version,code_version,manifest,manifest_hash,expected_profiles) VALUES('pilot',1,'founder-dna-v1','{}','hash',1)",
    );
    await assert.rejects(
      readFounderDnaCoverage(bare.db, "pilot"),
      /dna_coverage_directory_schema_missing/,
    );
  } finally {
    await bare.pg.close();
  }
});

test("coverage command rejects malformed input before connecting and does not spend", async () => {
  let connected = false;
  const connect = () => {
    connected = true;
    throw new Error("connect should not run");
  };
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://env-must-not-be-used";
  try {
    for (const args of [
      ["coverage"],
      ["coverage", "--database-url", "postgres://explicit"],
      ["coverage", "--release", "pilot"],
      [
        "coverage",
        "--database-url",
        "postgres://explicit",
        "--release",
        "bad id",
      ],
      [
        "coverage",
        "extra",
        "--database-url",
        "postgres://explicit",
        "--release",
        "pilot",
      ],
    ])
      await assert.rejects(releaseMain(args, { connect }));
    assert.equal(connected, false);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("public union above the unchanged release cap cannot activate", async () => {
  const { pg, db } = await migrated();
  try {
    assert.equal(DNA_RELEASE_PROFILE_LIMIT, 1000);
    const ready = await stageReady(db, "ready", "pilot");
    await assert.rejects(
      ready.dna.createRelease({
        id: "too-big",
        manifest: {},
        expectedProfiles: 1001,
      }),
      /invalid_dna_release/,
    );
    const handles = Array.from({ length: 1001 }, (_, index) => `f${index}`);
    await db.query("INSERT INTO founders(handle) SELECT unnest($1::text[])", [
      handles,
    ]);
    await ready.dna.validateRelease("pilot");
    const report = await readFounderDnaCoverage(db, "pilot");
    assert.equal(report.union.total, 1001);
    assert.equal(report.missingTruncated, true);
    assert.equal(report.missing.length, 1000);
    assert.equal(report.releaseProfileLimit, 1000);
    await assert.rejects(
      ready.dna.activateRelease("pilot"),
      /dna_coverage_exceeds_release_limit/,
    );
    assert.equal(await activeRelease(db), null);
  } finally {
    await pg.close();
  }
});
