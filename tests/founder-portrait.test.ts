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
import { stableDigest, stableUuid } from "../lib/enrichment/contracts";
import { founderDnaFixture } from "./fixtures/founder-dna";
import { readFounderDnaProfile } from "../lib/founder-dna-data";
import { MODEL, type Request } from "../lib/typesafe-poc";
async function verifyPortrait(
  scenario:
    | "unchanged replay"
    | "wrong citation"
    | "new product"
    | "wrong roast citation"
    | "wrong portrait citation"
    | "unsupported trait"
    | "long judge request"
    | "maximum profile"
    | "oversized evidence"
    | "interrupted check"
    | "interrupted budget",
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
    if (
      scenario === "long judge request" ||
      scenario === "maximum profile" ||
      scenario === "oversized evidence"
    ) {
      for (let i = 0; i < 4; i++) {
        const id = await store.addEvidence({
          artifactId: raw.id,
          extractorVersion: "v1",
          locator: `long-${i}`,
          excerpt: "Designer building scheduling tools. ".repeat(
            scenario === "oversized evidence" ? 1200 : 60,
          ),
          payload: {},
          sourceUrl: `https://example.com/long-${i}`,
        });
        await store.linkEvidence(entityId, id, "bio");
        selectedEvidenceIds.push(id);
      }
    }
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
      capMicros: "100000",
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
        assert.ok(["facts", "prose", "facets"].includes(state.mode));
        const ids = state.evidence.map((source: { id: string }) => source.id);
        const sourceIds = (refs: number[]) =>
          refs.map((index) => state.evidence[index].id);
        if (state.mode === "facts") {
          assert.equal(state.prose.length, 0);
          for (const claim of state.claims)
            assert.deepEqual(
              new Set(sourceIds(claim.sourceRefs)),
              new Set(ids),
            );
          if (scenario === "wrong citation")
            assert.deepEqual(ids, [wrongEvidenceId]);
        }
        if (state.mode === "prose") {
          for (const clause of state.prose)
            assert.equal(clause.factRefs.length, state.claims.length);
          assert.deepEqual(
            new Set(
              state.claims.flatMap((claim: { sourceRefs: number[] }) =>
                sourceIds(claim.sourceRefs),
              ),
            ),
            new Set(ids),
          );
        }
        const savedEvidence = await new (
          await import("../lib/enrichment/worker-store")
        ).WorkerStore(db).evidenceByIds(entityId, ids);
        assert.deepEqual(
          state.evidence.map((source: { text: string }) => source.text).sort(),
          savedEvidence.map((source) => source.text).sort(),
        );
        assert.ok(Buffer.byteLength(String(init?.body)) <= 40000);
        return new Response(
          JSON.stringify({
            model: MODEL,
            answers: Object.fromEntries(
              Object.entries(request.questions).map(([key, q]) => {
                const claim = state.claims.find(
                  (item: { key: string }) => item.key === key,
                );
                const scope = state.prose.find(
                  (item: { key: string }) => item.key === key,
                );
                const citedSourceIds = scope
                  ? sourceIds(
                      scope.factRefs.flatMap(
                        (index: number) => state.claims[index].sourceRefs,
                      ),
                    )
                  : [];
                const proseSupported =
                  !scope ||
                  !scope.text.includes("Zurich") ||
                  citedSourceIds.includes(wrongEvidenceId);
                const choice =
                  key === "trait_safety"
                    ? scenario === "unsupported trait" &&
                      state.prose.some(
                        (item: { path: string }) =>
                          item.path === "archetype.summary",
                      )
                      ? "unsupported_trait"
                      : "trait_safe"
                    : state.mode === "facts"
                      ? (
                          claim.text.includes("Zurich")
                            ? ids.includes(wrongEvidenceId)
                            : ids.includes(evidenceId)
                        )
                        ? "supported"
                        : "unsupported"
                      : state.mode === "prose"
                        ? proseSupported
                          ? "grounded"
                          : "unsupported"
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
    const generationCache = new Map<
      string,
      {
        attemptId: string;
        rawResponse: string;
        responseArtifactId: string;
        usage: null;
        finishReason: string;
      }
    >();
    const executeGeneration = async ({ runId }: { runId: string }) => {
      if (generationCache.has(runId)) return generationCache.get(runId)!;
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
      if (scenario === "unsupported trait")
        draft.archetype.summary =
          "Alex is a relentlessly curious perfectionist.";
      if (
        scenario === "wrong roast citation" ||
        scenario === "wrong portrait citation"
      ) {
        draft.facts.push({
          id: "fact-location",
          text: "Alex lives in Zurich.",
          evidenceIds: [wrongEvidenceId],
        });
        if (scenario === "wrong roast citation") {
          draft.factIds = ["fact-design", "fact-location"];
          draft.roast.lines = [
            { text: "Alex lives in Zurich.", factIds: ["fact-design"] },
          ];
        } else {
          draft.shareText = "Alex lives in Zurich.";
        }
      }
      if (scenario === "long judge request" || scenario === "maximum profile") {
        const repeated = (limit: number) =>
          "Design scheduling tools. ".repeat(60).slice(0, limit);
        draft.facts = Array.from(
          { length: scenario === "maximum profile" ? 8 : 6 },
          (_, i) => ({
            id: i === 0 ? "fact-design" : randomUUID(),
            text: repeated(1200),
            evidenceIds: selectedEvidenceIds,
          }),
        );
        draft.factIds = draft.facts.map((f) => f.id);
        draft.archetype = {
          title: repeated(100),
          kicker: repeated(100),
          hook: repeated(200),
          summary: repeated(500),
          tags: Array.from({ length: 4 }, () => repeated(40)),
        };
        draft.roast = {
          title: repeated(100),
          lines: Array.from({ length: 3 }, () => ({
            text: repeated(300),
            factIds: draft.factIds,
          })),
        };
        draft.story = {
          title: repeated(100),
          before: repeated(240),
          after: repeated(240),
          connection: repeated(500),
        };
        draft.shareText = repeated(260);
        if (scenario === "maximum profile") {
          draft.facts = Array.from({ length: 8 }, (_, i) => ({
            id: i === 0 ? "fact-design" : randomUUID().padEnd(120, "x"),
            text: repeated(1200),
            evidenceIds: selectedEvidenceIds,
          }));
          draft.factIds = draft.facts.map((fact) => fact.id);
          draft.archetype = {
            title: repeated(120),
            kicker: repeated(120),
            hook: repeated(240),
            summary: repeated(600),
            tags: Array.from({ length: 5 }, () => repeated(80)),
          };
          draft.roast = {
            title: repeated(120),
            lines: Array.from({ length: 5 }, () => ({
              text: repeated(400),
              factIds: draft.factIds,
            })),
          };
          draft.story = {
            title: repeated(120),
            before: repeated(240),
            after: repeated(240),
            connection: repeated(600),
          };
          draft.shareText = repeated(1200);
        }
      }
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
      const result = {
        attemptId: attempt.id,
        rawResponse,
        responseArtifactId: artifact.id,
        usage: null,
        finishReason: "stop",
      };
      generationCache.set(runId, result);
      return result;
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
    if (scenario === "oversized evidence") {
      await assert.rejects(
        runFounderPortrait(store, input, {
          executeGeneration,
          executeDecision,
        }),
        /portrait_judge_request_too_large/,
      );
      assert.equal(textCalls, 0);
      assert.equal(judgeCalls, 0);
      return;
    }
    if (scenario === "interrupted check" || scenario === "interrupted budget") {
      let decisions = 0;
      await assert.rejects(
        runFounderPortrait(store, input, {
          executeGeneration,
          executeDecision: async (request) => {
            if (++decisions === 2)
              throw new Error(
                scenario === "interrupted budget"
                  ? "record not found or state conflict"
                  : "request already reserved, captured, or uncertain",
              );
            return executeDecision(request);
          },
        }),
        /jev_execution_interrupted/,
      );
      assert.equal(
        (
          await db.query(
            "SELECT id FROM enrichment_analysis_runs WHERE purpose='founder_portrait'",
          )
        ).rows.length,
        0,
      );
      const interrupted = await db.query<{
        metadata: { judgeExchanges: unknown[] };
      }>(
        "SELECT metadata FROM enrichment_artifacts WHERE metadata->>'purpose'='portrait_check_interruption'",
      );
      assert.equal(interrupted.rows[0].metadata.judgeExchanges.length, 1);
    }
    const result = await runFounderPortrait(store, input, {
      executeGeneration,
      executeDecision,
    });
    if (
      scenario === "wrong citation" ||
      scenario === "wrong roast citation" ||
      scenario === "wrong portrait citation" ||
      scenario === "unsupported trait"
    ) {
      assert.equal(result.status, "failed");
      assert.equal(result.output, null);
      const saved = await db.query<{
        validation_report: {
          error: string;
          proseCitations: Record<
            string,
            { path: string; factIds: string[]; sourceIds: string[] }
          >;
        };
      }>("SELECT validation_report FROM enrichment_analysis_runs WHERE id=$1", [
        result.analysisId,
      ]);
      assert.equal(
        saved.rows[0].validation_report.error,
        scenario === "wrong citation"
          ? "portrait_fact_not_supported"
          : scenario === "unsupported trait"
            ? "portrait_trait_not_supported"
            : "portrait_prose_not_grounded",
      );
      if (
        scenario === "wrong roast citation" ||
        scenario === "wrong portrait citation"
      ) {
        const path =
          scenario === "wrong roast citation" ? "roast.lines.0" : "shareText";
        const savedScope = Object.values(
          saved.rows[0].validation_report.proseCitations,
        ).find((scope) => scope.path === path);
        assert.deepEqual(savedScope?.factIds, ["fact-design"]);
        assert.deepEqual(savedScope?.sourceIds, [evidenceId]);
      }
      await assert.rejects(
        dna.approvePortrait(entityId, result.analysisId, "reviewer"),
      );
      return;
    }
    assert.equal(
      result.status,
      "succeeded",
      JSON.stringify(
        (
          await db.query(
            "SELECT validation_report->>'error' AS error FROM enrichment_analysis_runs WHERE id=$1",
            [result.analysisId],
          )
        ).rows,
      ),
    );
    const savedIdentity = (
      await db.query<{
        input_digest: string;
        recipe_digest: string;
        validation_report: {
          generationRunId: string;
          judgeRecipeVersion: string;
          judgeRequestBytes: number;
        };
      }>(
        "SELECT input_digest,recipe_digest,validation_report FROM enrichment_analysis_runs WHERE id=$1",
        [result.analysisId],
      )
    ).rows[0];
    assert.equal(
      savedIdentity.validation_report.generationRunId,
      stableUuid({
        entityId,
        inputDigest: savedIdentity.input_digest,
        recipeDigest: savedIdentity.recipe_digest,
        founderAnalysisId,
        releaseId,
        generation: 0,
      }),
    );
    assert.notEqual(
      result.analysisId,
      savedIdentity.validation_report.generationRunId,
    );
    assert.equal(
      savedIdentity.validation_report.judgeRecipeVersion,
      "cited-founder-portrait-judge-v6",
    );
    if (scenario === "long judge request" || scenario === "maximum profile")
      console.log(
        `Synthetic compact judge request: ${savedIdentity.validation_report.judgeRequestBytes} bytes`,
      );
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
    assert.equal(judgeCalls, 3);
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
      assert.equal(judgeCalls, 6);
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
    const checkedRun = (
      await db.query<{
        validation_report: {
          judgeExchanges: {
            requestArtifactId: string;
            responseArtifactId: string;
          }[];
        };
      }>("SELECT validation_report FROM enrichment_analysis_runs WHERE id=$1", [
        publicationResult.analysisId,
      ])
    ).rows[0];
    const captureIds = checkedRun.validation_report.judgeExchanges.flatMap(
      (exchange) => [exchange.requestArtifactId, exchange.responseArtifactId],
    );
    assert.ok(captureIds.length >= 6);
    if (scenario === "unchanged replay") {
      await db.query(
        "INSERT INTO enrichment_artifact_withdrawals(artifact_id,actor,reason) VALUES($1,'test','scoped response withdrawn')",
        [captureIds.at(-1)],
      );
      assert.equal(
        (await readFounderDnaProfile(db, "example")).status,
        "hidden",
      );
    }
    await store.withdrawArtifact(raw.id, "test", "withdraw");
    for (const id of captureIds)
      assert.equal(await store.getArtifact(id), null);
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
  "wrong roast citation",
  "wrong portrait citation",
  "unsupported trait",
  "long judge request",
  "maximum profile",
  "oversized evidence",
  "interrupted check",
  "interrupted budget",
] as const)
  test(`retained portrait: ${scenario}`, () => verifyPortrait(scenario));
