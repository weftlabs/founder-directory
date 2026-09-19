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
  dryRunDnaBundle,
  exportDnaBundle,
  parseDnaBundle,
  stageDnaBundle,
} from "../lib/enrichment/dna-bundle";
import { readFounderDnaProfile } from "../lib/founder-dna-data";
import { founderDnaFixture } from "./fixtures/founder-dna";
import { main } from "../scripts/founder-dna-release";
import { stableDigest } from "../lib/enrichment/contracts";
async function database() {
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
  return { pg, db };
}
async function seed(db: Database, withProduct = false, handle = "example") {
  const store = new EnrichmentStore(db),
    dna = new DnaPublicationStore(db);
  const entity = await store.createEntity("founder", handle);
  const raw = await store.putArtifact({
    kind: "legacy_import",
    body: Buffer.from("Designer"),
    contentType: "text/plain",
    redactionVersion: "none",
    importBatch: "synthetic",
  });
  const evidence = await store.addEvidence({
    artifactId: raw.id,
    extractorVersion: "v1",
    locator: "bio",
    authorId: handle === "example" ? "100" : "200",
    excerpt: "Designer",
    payload: {},
    sourceUrl: "https://example.com/alex",
  });
  await store.linkEvidence(entity, evidence, "bio");
  const release = await store.createRelease({ stages: ["founder_dna"] });
  await store.approveRelease(release, raw.id, {
    actor: "reviewer",
    reason: "synthetic",
  });
  const retained = await store.putArtifact({
    kind: "generation_response",
    body: Buffer.from('{"synthetic":"retained judgment"}'),
    contentType: "application/json",
    redactionVersion: "none",
    importBatch: "synthetic-judgment",
  });
  let product: string | undefined, productAnalysis: string | undefined;
  if (withProduct) {
    product = await store.createEntity("product", `product:${entity}:planner`);
    await store.linkEvidence(product, evidence, "product");
    await store.linkProduct(entity, product, evidence);
    productAnalysis = randomUUID();
    await store.saveAnalysis({
      id: productAnalysis,
      entityId: product,
      releaseId: release,
      generation: 0,
      purpose: "product_descriptions",
      inputArtifactId: raw.id,
      inputDigest: "product-input",
      recipeDigest: "product-recipe",
      evidenceIds: [evidence],
      output: {},
      validationReport: {},
      status: "succeeded",
    });
  }
  const analysis = randomUUID(),
    portrait = randomUUID(),
    profile = founderDnaFixture();
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
      releaseId: release,
      generation: 0,
      purpose,
      inputArtifactId: raw.id,
      inputDigest: "input",
      recipeDigest: "recipe",
      evidenceIds: [evidence],
      output,
      validationReport: {
        checksPassed: true,
        generationResponseArtifactId: retained.id,
        judgeRequestArtifactId: retained.id,
        judgeResponseArtifactId: retained.id,
        productAnalysisIds: productAnalysis ? [productAnalysis] : [],
      },
      status: "succeeded",
    });
  await dna.approvePortrait(entity, portrait, "reviewer");
  for (const id of ["release-one", "release-two"].map((id) =>
    handle === "example" ? id : `${handle}-${id}`,
  )) {
    await dna.createRelease({
      id,
      manifest: { cohort: [entity] },
      expectedProfiles: 1,
    });
    await dna.stageProfile({
      releaseId: id,
      entityId: entity,
      analysisId: analysis,
      portraitAnalysisId: portrait,
    });
  }
  // An unrelated retained record must not escape through a full table dump.
  await store.putArtifact({
    kind: "legacy_import",
    body: Buffer.from("Unrelated"),
    contentType: "text/plain",
    redactionVersion: "none",
    importBatch: "other",
  });
  return { entity, raw, evidence, analysis, portrait, product, store, dna };
}
test("private bundle dry-run is read-only; stage is repeatable, exact, isolated and rollback obeys withdrawal", async () => {
  const src = await database(),
    dst = await database();
  try {
    const seeded = await seed(src.db),
      bundle = await exportDnaBundle(src.db, "release-one");
    assert.equal(bundle.rows.enrichment_artifacts.length, 2);
    assert.equal(
      bundle.rows.enrichment_artifacts.find((row) => row.id === seeded.raw.id)!
        .body,
      Buffer.from("Designer").toString("base64"),
    );
    await dryRunDnaBundle(dst.db, bundle);
    assert.equal(
      (await dst.db.query("SELECT id FROM enrichment_entities")).rows.length,
      0,
    );
    await stageDnaBundle(dst.db, bundle);
    await stageDnaBundle(dst.db, bundle);
    assert.equal(
      (await dst.db.query("SELECT id FROM enrichment_artifacts")).rows.length,
      3,
    );
    assert.deepEqual(await readFounderDnaProfile(dst.db, "example"), {
      status: "not_found",
    });
    const dna = new DnaPublicationStore(dst.db);
    await dna.validateRelease("release-one");
    await dna.activateRelease("release-one");
    await stageDnaBundle(dst.db, bundle); // Replay after activation must also be safe.
    const restored = await exportDnaBundle(dst.db, "release-one");
    assert.deepEqual(restored.manifest.costs, bundle.manifest.costs);
    assert.equal(
      restored.rows.enrichment_artifacts.filter(
        (a) => a.redaction_version === "private-import-provenance-v1",
      ).length,
      1,
    );
    assert.equal(
      (await readFounderDnaProfile(dst.db, "example")).status,
      "ready",
    );
    await stageDnaBundle(dst.db, await exportDnaBundle(src.db, "release-two"));
    await dna.validateRelease("release-two");
    await dna.activateRelease("release-two");
    await dna.rollback();
    assert.equal(
      (
        await dst.db.query<{ release_id: string }>(
          "SELECT release_id FROM founder_dna_active_release",
        )
      ).rows[0].release_id,
      "release-one",
    );
    await new EnrichmentStore(dst.db).withdrawArtifact(
      seeded.raw.id,
      "reviewer",
      "withdrawn",
    );
    await assert.rejects(stageDnaBundle(dst.db, bundle), /withdrawn/);
    await assert.rejects(dna.rollback(), /ineligible/);
  } finally {
    await src.pg.close();
    await dst.pg.close();
  }
});
test("stage maps canonical founder identity and preserves raw retained bytes", async () => {
  const src = await database(),
    dst = await database();
  try {
    const seeded = await seed(src.db),
      otherId = await new EnrichmentStore(dst.db).createEntity(
        "founder",
        "example",
      );
    assert.notEqual(seeded.entity, otherId);
    const bundle = await exportDnaBundle(src.db, "release-one");
    assert.equal(
      (await dryRunDnaBundle(dst.db, bundle)).summary.identityMappings,
      1,
    );
    await stageDnaBundle(dst.db, bundle);
    const dna = new DnaPublicationStore(dst.db);
    await dna.validateRelease("release-one");
    await dna.activateRelease("release-one");
    const result = await readFounderDnaProfile(dst.db, "example");
    assert.equal(result.status, "ready");
    if (result.status === "ready") assert.equal(result.profile.id, otherId);
    assert.deepEqual(
      Buffer.from(
        (
          await dst.db.query<{ body: Uint8Array }>(
            "SELECT body FROM enrichment_artifacts WHERE id=$1",
            [seeded.raw.id],
          )
        ).rows[0].body,
      ),
      Buffer.from("Designer"),
    );
  } finally {
    await src.pg.close();
    await dst.pg.close();
  }
});
test("corruption, suppression, newer results and interrupted stage cannot move the active pointer", async () => {
  const src = await database(),
    dst = await database();
  try {
    await seed(src.db);
    const bundle = await exportDnaBundle(src.db, "release-one"),
      corrupt = structuredClone(bundle);
    corrupt.rows.enrichment_artifacts[0].body = "dGFtcGVyZWQ=";
    assert.throws(() => parseDnaBundle(corrupt), /hash_mismatch/);
    corrupt.manifest.rowsHash = stableDigest(corrupt.rows);
    corrupt.hash = stableDigest({
      manifest: corrupt.manifest,
      rows: corrupt.rows,
    });
    assert.throws(() => parseDnaBundle(corrupt), /artifact_hash_mismatch/);

    const interrupted: Database = {
      ...dst.db,
      transaction: (fn) =>
        dst.db.transaction((tx) =>
          fn({
            query: async (sql, values) => {
              if (sql.startsWith("INSERT INTO enrichment_analysis_runs"))
                throw new Error("simulated_disconnect");
              return tx.query(sql, values);
            },
          }),
        ),
    };
    await assert.rejects(
      stageDnaBundle(interrupted, bundle),
      /simulated_disconnect/,
    );
    assert.equal(
      (await dst.db.query("SELECT id FROM enrichment_entities")).rows.length,
      0,
    );
    await stageDnaBundle(dst.db, bundle);
    await dst.db.query("UPDATE enrichment_entities SET status='suppressed'");
    await assert.rejects(stageDnaBundle(dst.db, bundle), /suppressed/);
    await dst.db.query("UPDATE enrichment_entities SET status='active'");
    const newer = randomUUID(),
      old = bundle.rows.enrichment_analysis_runs.find(
        (a) => a.purpose === "founder_dna",
      )!;
    await dst.db.query(
      "INSERT INTO enrichment_analysis_runs SELECT * FROM jsonb_populate_record(NULL::enrichment_analysis_runs,$1::jsonb)",
      [
        JSON.stringify({
          ...old,
          id: newer,
          created_at: "2099-01-01T00:00:00Z",
        }),
      ],
    );
    await dst.db.query(
      "INSERT INTO enrichment_profiles(entity_id,analysis_id) VALUES($1,$2)",
      [old.entity_id, newer],
    );
    await assert.rejects(stageDnaBundle(dst.db, bundle), /newer_publication/);
    assert.equal(
      (await dst.db.query("SELECT release_id FROM founder_dna_active_release"))
        .rows.length,
      0,
    );
  } finally {
    await src.pg.close();
    await dst.pg.close();
  }
});
test("CLI refuses implicit connections and unconfirmed writes before connecting", async () => {
  await assert.rejects(
    main(["stage", "--file", "private.json"]),
    /Explicit --database-url/,
  );
  await assert.rejects(
    main([
      "activate",
      "--database-url",
      "postgres://unused",
      "--release",
      "one",
    ]),
    /confirm-write/,
  );
});

test("retained product dependency closure maps the established owner/name identity", async () => {
  const src = await database(),
    dst = await database();
  try {
    const seeded = await seed(src.db, true),
      target = new EnrichmentStore(dst.db);
    const founder = await target.createEntity("founder", "example"),
      product = await target.createEntity(
        "product",
        `product:${founder}:planner`,
      );
    const bundle = await exportDnaBundle(src.db, "release-one");
    assert.equal(bundle.rows.enrichment_analysis_runs.length, 3);
    assert.equal(bundle.rows.enrichment_founder_products.length, 1);
    assert.equal(
      (await dryRunDnaBundle(dst.db, bundle)).mapping[seeded.product!],
      product,
    );
    await stageDnaBundle(dst.db, bundle);
    await stageDnaBundle(dst.db, bundle);
    const dna = new DnaPublicationStore(dst.db);
    await dna.validateRelease("release-one");
    await dna.activateRelease("release-one");
    assert.equal(
      (await readFounderDnaProfile(dst.db, "example")).status,
      "ready",
    );
    await dst.db.query(
      "UPDATE enrichment_entities SET status='suppressed' WHERE id=$1",
      [product],
    );
    assert.equal(
      (await readFounderDnaProfile(dst.db, "example")).status,
      "hidden",
    );
    await assert.rejects(stageDnaBundle(dst.db, bundle), /suppressed/);
  } finally {
    await src.pg.close();
    await dst.pg.close();
  }
});

test("edge transfer retains both endpoints and accepted decision artifacts", async () => {
  const src = await database(),
    dst = await database();
  try {
    const left = await seed(src.db),
      right = await seed(src.db, false, "second");
    await left.dna.createRelease({
      id: "connected",
      manifest: { cohort: [left.entity, right.entity] },
      expectedProfiles: 2,
    });
    for (const person of [left, right])
      await left.dna.stageProfile({
        releaseId: "connected",
        entityId: person.entity,
        analysisId: person.analysis,
        portraitAnalysisId: person.portrait,
      });
    await left.dna.saveConnectionDecision({
      id: "related-pair",
      leftEntityId: left.entity,
      rightEntityId: right.entity,
      leftAnalysisId: left.analysis,
      rightAnalysisId: right.analysis,
      relation: "related_work",
      recipeVersion: "synthetic-v1",
      model: "synthetic",
      candidateMethod: "exact-cosine",
      state: "accepted",
      reason: "Both discuss design work.",
      leftEvidenceIds: [left.evidence],
      rightEvidenceIds: [right.evidence],
      requestArtifactId: left.raw.id,
      responseArtifactId: right.raw.id,
    });
    await left.dna.stageConnection("connected", "related-pair");
    const bundle = await exportDnaBundle(src.db, "connected");
    assert.equal(bundle.rows.founder_dna_connection_decisions.length, 1);
    await stageDnaBundle(dst.db, bundle);
    const dna = new DnaPublicationStore(dst.db);
    await dna.validateRelease("connected");
    await dna.activateRelease("connected");
    const result = await readFounderDnaProfile(dst.db, "example");
    assert.equal(result.status, "ready");
    if (result.status === "ready")
      assert.equal(result.profile.connections.length, 1);
    await new EnrichmentStore(dst.db).withdrawArtifact(
      right.raw.id,
      "reviewer",
      "withdrawn",
    );
    const withdrawn = await readFounderDnaProfile(dst.db, "example");
    assert.equal(withdrawn.status, "ready");
    if (withdrawn.status === "ready")
      assert.equal(withdrawn.profile.connections.length, 0);
  } finally {
    await src.pg.close();
    await dst.pg.close();
  }
});

test("a reassigned handle cannot merge conflicting known source author identities", async () => {
  const src = await database(),
    dst = await database();
  try {
    await seed(src.db);
    const store = new EnrichmentStore(dst.db),
      entity = await store.createEntity("founder", "example");
    const raw = await store.putArtifact({
      kind: "legacy_import",
      body: Buffer.from("Another account"),
      contentType: "text/plain",
      redactionVersion: "none",
      importBatch: "other-account",
    });
    const evidence = await store.addEvidence({
      artifactId: raw.id,
      extractorVersion: "v1",
      locator: "bio",
      authorId: "999",
      payload: {},
      excerpt: "Another account",
    });
    await store.linkEvidence(entity, evidence, "profile_source");
    const bundle = await exportDnaBundle(src.db, "release-one");
    await assert.rejects(
      dryRunDnaBundle(dst.db, bundle),
      /founder_source_identity_conflict/,
    );
    await assert.rejects(
      stageDnaBundle(dst.db, bundle),
      /founder_source_identity_conflict/,
    );
    assert.equal(
      (await dst.db.query("SELECT id FROM enrichment_entities")).rows.length,
      1,
    );
    assert.equal(
      (await dst.db.query("SELECT id FROM founder_dna_releases")).rows.length,
      0,
    );
  } finally {
    await src.pg.close();
    await dst.pg.close();
  }
});
