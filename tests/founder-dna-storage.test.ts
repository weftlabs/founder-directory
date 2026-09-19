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
import { readFounderDnaProfile } from "../lib/founder-dna-data";
import { founderDnaFixture } from "./fixtures/founder-dna";
export async function dnaDatabase() {
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
test("data releases stage without exposure, activate atomically, roll back and obey withdrawal", async () => {
  const { pg, db } = await dnaDatabase(),
    store = new EnrichmentStore(db),
    dna = new DnaPublicationStore(db);
  try {
    const entity = await store.createEntity("founder", "example"),
      raw = await store.putArtifact({
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
      excerpt: "Designer",
      payload: {},
      sourceUrl: "https://example.com/alex",
    });
    await store.linkEvidence(entity, evidence, "bio");
    const release = await store.createRelease({ stages: ["founder_dna"] });
    await store.approveRelease(release, raw.id, {
      actor: "test",
      reason: "synthetic",
    });
    const analysis = randomUUID(),
      portrait = randomUUID();
    const profile = founderDnaFixture();
    profile.id = entity;
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
        validationReport: {},
        status: "succeeded",
      });
    await dna.approvePortrait(entity, portrait, "reviewer");
    for (const id of ["data-one", "data-two"]) {
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
    assert.deepEqual(await readFounderDnaProfile(db, "example"), {
      status: "not_found",
    });
    await assert.rejects(dna.activateRelease("data-one"), /not_validated/);
    await dna.validateRelease("data-one");
    await dna.activateRelease("data-one");
    const first = await readFounderDnaProfile(db, "example");
    assert.equal(first.status, "ready");
    if (first.status === "ready")
      assert.equal(first.profile.releaseId, "data-one");
    await dna.validateRelease("data-two");
    await dna.activateRelease("data-two");
    await dna.rollback();
    const back = await readFounderDnaProfile(db, "example");
    if (back.status === "ready")
      assert.equal(back.profile.releaseId, "data-one");
    else assert.fail(back.status);
    await store.withdrawArtifact(raw.id, "test", "withdrawn");
    assert.deepEqual(await readFounderDnaProfile(db, "example"), {
      status: "hidden",
    });
    await assert.rejects(dna.activateRelease("data-two"), /ineligible/);
  } finally {
    await pg.close();
  }
});
