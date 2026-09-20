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
  readFounderDnaProfile,
  readFounderDnaReleaseProfile,
} from "../lib/founder-dna-data";
import { founderDnaFixture } from "./fixtures/founder-dna";
import { main as releaseMain } from "../scripts/founder-dna-release";
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
    assert.deepEqual(
      await readFounderDnaReleaseProfile(db, "data-two", "example"),
      { status: "unavailable" },
    );
    await dna.validateRelease("data-two");
    const inactive = await readFounderDnaReleaseProfile(
      db,
      "data-two",
      "example",
    );
    assert.equal(inactive.status, "ready");
    if (inactive.status === "ready")
      assert.equal(inactive.profile.releaseId, "data-two");
    let closed = false;
    assert.deepEqual(
      await releaseMain(
        [
          "preview",
          "--database-url",
          "postgres://explicit-test-only",
          "--release",
          "data-two",
          "--handle",
          "example",
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
      ),
      { command: "preview", release: "data-two", result: inactive },
    );
    assert.equal(closed, true);
    const stillFirst = await readFounderDnaProfile(db, "example");
    assert.equal(stillFirst.status, "ready");
    if (stillFirst.status === "ready")
      assert.equal(stillFirst.profile.releaseId, "data-one");
    await dna.activateRelease("data-two");
    await dna.rollback();
    const back = await readFounderDnaProfile(db, "example");
    if (back.status === "ready")
      assert.equal(back.profile.releaseId, "data-one");
    else assert.fail(back.status);
    await store.withdrawArtifact(raw.id, "test", "withdrawn");
    assert.deepEqual(
      await readFounderDnaReleaseProfile(db, "data-two", "example"),
      { status: "hidden" },
    );
    assert.deepEqual(await readFounderDnaProfile(db, "example"), {
      status: "hidden",
    });
    await assert.rejects(dna.activateRelease("data-two"), /ineligible/);
  } finally {
    await pg.close();
  }
});

test("accepted connections expose both founders' source records through the public reader", async () => {
  const { pg, db } = await dnaDatabase();
  const store = new EnrichmentStore(db);
  const dna = new DnaPublicationStore(db);
  try {
    const releaseId = "connected-founders";
    await dna.createRelease({
      id: releaseId,
      manifest: {},
      expectedProfiles: 2,
    });
    const endpoints = [];
    for (const handle of ["example", "other_example"]) {
      const entityId = await store.createEntity("founder", handle);
      const raw = await store.putArtifact({
        kind: "legacy_import",
        body: Buffer.from(`${handle} designs scheduling tools.`),
        contentType: "text/plain",
        redactionVersion: "none",
        importBatch: "synthetic-connection",
      });
      const evidenceId = await store.addEvidence({
        artifactId: raw.id,
        extractorVersion: "v1",
        locator: "bio",
        excerpt: `${handle} designs scheduling tools.`,
        payload: {},
        sourceUrl: `https://example.com/${handle}`,
      });
      await store.linkEvidence(entityId, evidenceId, "bio");
      const executionRelease = await store.createRelease({
        stages: ["founder_dna"],
        fixture: handle,
      });
      await store.approveRelease(executionRelease, raw.id, {
        actor: "test",
        reason: "synthetic",
      });
      const analysisId = randomUUID();
      const portraitAnalysisId = randomUUID();
      const profile = founderDnaFixture();
      profile.id = entityId;
      profile.handle = handle;
      profile.analysisId = analysisId;
      profile.portrait.analysisId = portraitAnalysisId;
      profile.sources[0].id = evidenceId;
      profile.sources[0].url = `https://example.com/${handle}`;
      profile.facts[0].sourceIds = [evidenceId];
      for (const [id, purpose, output] of [
        [analysisId, "founder_dna", {}],
        [portraitAnalysisId, "founder_portrait", { profile }],
      ] as const) {
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
      }
      await dna.approvePortrait(entityId, portraitAnalysisId, "reviewer");
      await dna.stageProfile({
        releaseId,
        entityId,
        analysisId,
        portraitAnalysisId,
      });
      endpoints.push({
        entityId,
        analysisId,
        evidenceId,
        rawId: raw.id,
        handle,
      });
    }
    const [left, right] = endpoints;
    await dna.saveConnectionDecision({
      id: "shared-work",
      leftEntityId: left.entityId,
      rightEntityId: right.entityId,
      leftAnalysisId: left.analysisId,
      rightAnalysisId: right.analysisId,
      relation: "related_work",
      recipeVersion: "test",
      model: "test",
      candidateMethod: "synthetic",
      state: "accepted",
      reason: "Both describe work on scheduling tools.",
      leftEvidenceIds: [left.evidenceId],
      rightEvidenceIds: [right.evidenceId],
      requestArtifactId: left.rawId,
      responseArtifactId: right.rawId,
    });
    await dna.stageConnection(releaseId, "shared-work");
    await dna.validateRelease(releaseId);
    await dna.activateRelease(releaseId);
    for (const endpoint of endpoints) {
      const result = await readFounderDnaProfile(db, endpoint.handle);
      assert.equal(result.status, "ready");
      if (result.status !== "ready") assert.fail("expected ready profile");
      const connections = result.profile.connections;
      assert.equal(connections.length, 1);
      assert.deepEqual(
        new Set(connections[0].sourceIds),
        new Set([left.evidenceId, right.evidenceId]),
      );
      assert.deepEqual(
        new Set(connections[0].sources.map((s) => s.id)),
        new Set([left.evidenceId, right.evidenceId]),
      );
      assert.ok(
        connections[0].sources.every((s) =>
          s.url.startsWith("https://example.com/"),
        ),
      );
    }
    await store.withdrawArtifact(right.rawId, "test", "withdraw endpoint");
    const remaining = await readFounderDnaProfile(db, left.handle);
    assert.equal(remaining.status, "ready");
    if (remaining.status === "ready")
      assert.deepEqual(remaining.profile.connections, []);
  } finally {
    await pg.close();
  }
});
