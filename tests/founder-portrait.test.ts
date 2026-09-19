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
  founderPortraitRecipe,
  runFounderPortrait,
} from "../lib/enrichment/founder-portrait";
import { retainedJev } from "../lib/enrichment/retained-jev";
import { stableDigest } from "../lib/enrichment/contracts";
import { founderDnaFixture } from "./fixtures/founder-dna";
import { readFounderDnaProfile } from "../lib/founder-dna-data";
import { MODEL, type Request } from "../lib/typesafe-poc";
async function verifyPortrait(
  scenario: "unchanged replay" | "wrong citation" | "new product",
) {
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
    const store = new EnrichmentStore(db),
      dna = new DnaPublicationStore(db);
    const model = {
      provider: "weft/openrouter",
      model: "synthetic",
      revision: null,
    };
    const recipe = founderPortraitRecipe(model, "test");
    const entityId = await store.createEntity("founder", "example"),
      raw = await store.putArtifact({
        kind: "legacy_import",
        body: Buffer.from("Designer building scheduling tools."),
        contentType: "text/plain",
        redactionVersion: "none",
        importBatch: "test",
        metadata: {
          sourceKind: "self-reported",
          observedAt: "2026-01-01T00:00:00Z",
        },
      });
    const evidenceId = await store.addEvidence({
      artifactId: raw.id,
      extractorVersion: "v1",
      locator: "bio",
      excerpt: "Designer building scheduling tools.",
      payload: {
        handle: "example",
        name: "Alex Example",
        bio: "Designer building scheduling tools.",
      },
      sourceUrl: "https://example.com/alex",
    });
    await store.linkEvidence(entityId, evidenceId, "bio");
    const wrongEvidenceId = await store.addEvidence({
      artifactId: raw.id,
      extractorVersion: "v1",
      locator: "location",
      excerpt: "Lives in Zurich.",
      payload: {},
      sourceUrl: "https://example.com/location",
    });
    await store.linkEvidence(entityId, wrongEvidenceId, "bio");
    const selectedEvidenceIds = [evidenceId, wrongEvidenceId];
    const releaseId = await store.createRelease({
      stages: ["founder_dna", "founder_portrait"],
      recipes: { founder_portrait: stableDigest(recipe) },
    });
    await store.approveRelease(releaseId, raw.id, {
      actor: "test",
      reason: "synthetic",
    });
    await store.promoteRelease("test", releaseId, "test");
    await store.intake("test", entityId);
    const founderAnalysisId = await store.saveAnalysis({
      entityId,
      releaseId,
      generation: 0,
      purpose: "founder_dna",
      inputArtifactId: raw.id,
      inputDigest: "synthetic",
      recipeDigest: "synthetic",
      evidenceIds: selectedEvidenceIds,
      output: {},
      validationReport: {},
      status: "succeeded",
    });
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "10000",
    });
    let textCalls = 0,
      judgeCalls = 0;
    const executeDecision = retainedJev(store, {
      scope: "test",
      budgetId,
      capMicros: "3000",
      policy: {
        id: "test",
        scope: "test",
        operation: "typesafe-systemone",
        storageVerified: true,
        retentionApproved: true,
      },
      mode: "acquire",
      enabled: () => true,
      apiKey: "synthetic",
      fetcher: async (_url, init) => {
        judgeCalls++;
        const request = JSON.parse(String(init?.body)) as Request;
        const state = JSON.parse(request.state);
        // The mock judge uses the claim's own cited scope, not other evidence in the state.
        const claim = state.claims[0];
        assert.equal(typeof claim, "object");
        const claimSupported = claim.sourceIds.includes(evidenceId);
        assert.deepEqual(
          claim.evidence.map((e: { id: string }) => e.id),
          claim.sourceIds,
        );
        assert.match(
          request.questions.claim_0.instructions,
          /only.*claims\[0\]\.evidence/i,
        );
        return new Response(
          JSON.stringify({
            model: MODEL,
            answers: Object.fromEntries(
              Object.entries(request.questions).map(([key, q]) => {
                const choice = key.startsWith("claim_")
                  ? claimSupported
                    ? "supported"
                    : "unsupported"
                  : key.startsWith("prose_")
                    ? "grounded_editorial"
                    : "unknown";
                return [
                  key,
                  {
                    type: "choice",
                    choice,
                    confidence: 0.8,
                    probabilities: Object.fromEntries(
                      Object.keys(q.criteria).map((k) => [
                        k,
                        Number(k === choice),
                      ]),
                    ),
                  },
                ];
              }),
            ),
            usage: { input_tokens: 100, output_tokens: 100 },
          }),
        );
      },
    });
    const executeGeneration = async ({ runId }: { runId: string }) => {
      textCalls++;
      const p = founderDnaFixture().portrait;
      const draft = {
        archetype: p.archetype,
        roast: p.roast,
        story: p.story,
        shareText: p.shareText,
        factIds: p.factIds,
        facts: [
          {
            id: "fact-design",
            text: "Alex describes design work.",
            evidenceIds: [
              scenario === "wrong citation" ? wrongEvidenceId : evidenceId,
            ],
          },
        ],
      };
      const rawResponse = JSON.stringify(draft);
      const request = await store.planCollection({
        scope: "test",
        fingerprint: runId,
        generation: 0,
        operation: "synthetic-generation",
        args: { runId },
        policyId: "test",
      });
      const attempt = await store.reserveAttempt({
        requestId: request.id,
        budgetId,
        capMicros: "100",
      });
      await store.markDispatched(attempt.id);
      const artifact = await store.captureResponse({
        attemptId: attempt.id,
        kind: "generation_response",
        body: Buffer.from(rawResponse),
        contentType: "application/json",
        redactionVersion: "none",
        paymentState: "not_charged",
        metadata: { attemptId: attempt.id },
      });
      return {
        attemptId: attempt.id,
        rawResponse,
        responseArtifactId: artifact.id,
        usage: null,
        finishReason: "stop",
      };
    };
    const input = {
      entityId,
      founderAnalysisId,
      releaseId,
      generation: 0,
      evidenceIds: selectedEvidenceIds,
      model,
      codeDigest: "test",
    };
    const result = await runFounderPortrait(store, input, {
      executeGeneration,
      executeDecision,
    });
    if (scenario === "wrong citation") {
      assert.equal(result.status, "failed");
      assert.equal(result.output, null);
      const saved = await db.query<{ validation_report: { error: string } }>(
        "SELECT validation_report FROM enrichment_analysis_runs WHERE id=$1",
        [result.analysisId],
      );
      assert.equal(
        saved.rows[0].validation_report.error,
        "portrait_fact_not_supported",
      );
      await assert.rejects(
        dna.approvePortrait(entityId, result.analysisId, "reviewer"),
      );
      return;
    }
    assert.equal(result.status, "succeeded");
    assert.equal(result.output?.profile.name, "Alex Example");
    assert.deepEqual(result.output?.profile.products, []);
    const replay = await runFounderPortrait(store, input, {
      executeGeneration: async () => {
        throw new Error("network");
      },
      executeDecision: async () => {
        throw new Error("network");
      },
    });
    assert.equal(replay.status, "reused");
    assert.equal(textCalls, 1);
    assert.equal(judgeCalls, 1);
    let publicationResult = result;
    if (scenario === "new product") {
      const productId = await store.createEntity("product", "new-product");
      await store.linkEvidence(productId, evidenceId, "product");
      await db.query(
        "INSERT INTO enrichment_founder_products(founder_id,product_id,evidence_id) VALUES($1,$2,$3)",
        [entityId, productId, evidenceId],
      );
      const productAnalysis = await store.saveAnalysis({
        entityId: productId,
        releaseId,
        generation: 0,
        purpose: "product_descriptions",
        inputArtifactId: raw.id,
        inputDigest: "product",
        recipeDigest: "product",
        evidenceIds: [evidenceId],
        output: {
          claims: [
            {
              field: "name",
              value: "New scheduling tool",
              kind: "publisher_statement",
              state: "supported",
            },
          ],
        },
        validationReport: {},
        status: "succeeded",
      });
      await db.query(
        "INSERT INTO enrichment_profiles(entity_id,analysis_id) VALUES($1,$2)",
        [productId, productAnalysis],
      );
      const refreshed = await runFounderPortrait(store, input, {
        executeGeneration,
        executeDecision,
      });
      assert.equal(refreshed.status, "succeeded");
      assert.notEqual(refreshed.analysisId, result.analysisId);
      assert.equal(refreshed.output?.profile.products.length, 1);
      assert.notEqual(
        refreshed.output?.profile.sourceRevision,
        result.output?.profile.sourceRevision,
      );
      const secondReplay = await runFounderPortrait(store, input, {
        executeGeneration: async () => {
          throw new Error("unexpected generation");
        },
        executeDecision: async () => {
          throw new Error("unexpected decision");
        },
      });
      assert.equal(secondReplay.status, "reused");
      assert.equal(secondReplay.analysisId, refreshed.analysisId);
      assert.equal(textCalls, 2);
      assert.equal(judgeCalls, 2);
      publicationResult = refreshed;
    }
    await dna.approvePortrait(
      entityId,
      publicationResult.analysisId,
      "reviewer",
    );
    await dna.createRelease({
      id: "pilot",
      expectedProfiles: 1,
      manifest: { cohort: [entityId] },
    });
    await dna.stageProfile({
      releaseId: "pilot",
      entityId,
      analysisId: founderAnalysisId,
      portraitAnalysisId: publicationResult.analysisId,
    });
    await dna.validateRelease("pilot");
    await dna.activateRelease("pilot");
    assert.equal((await readFounderDnaProfile(db, "example")).status, "ready");
    const accounting = (
      await db.query<{ payment_state: string; cap_micros: string }>(
        "SELECT payment_state,cap_micros::text FROM enrichment_collection_attempts WHERE cap_micros=3000",
      )
    ).rows[0];
    assert.equal(accounting.payment_state, "uncertain");
    assert.equal(accounting.cap_micros, "3000");
    await store.withdrawArtifact(raw.id, "test", "withdraw");
    assert.equal((await readFounderDnaProfile(db, "example")).status, "hidden");
    await assert.rejects(
      runFounderPortrait(store, input, {
        executeGeneration,
        executeDecision,
      }),
      /unavailable/,
    );
  } finally {
    await pg.close();
  }
}
for (const scenario of [
  "unchanged replay",
  "wrong citation",
  "new product",
] as const)
  test(`retained portrait: ${scenario}`, () => verifyPortrait(scenario));
