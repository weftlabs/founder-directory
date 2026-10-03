import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  migrateEnrichment,
  type Database,
  type Sql,
} from "../lib/enrichment/db";
import { EnrichmentStore } from "../lib/enrichment/store";
import { canonicalJson, stableDigest } from "../lib/enrichment/contracts";
import { llmJudge, parseJudgeAnswers } from "../lib/enrichment/llm-judge";
import type { Request } from "../lib/typesafe-poc";
import type { WeftTransport } from "../lib/weft";

const request: Request = {
  model: "jev-1.13.0",
  state: canonicalJson({
    evidence: [{ id: "e1", text: "Ships every Friday" }],
  }),
  questions: {
    f1: {
      type: "choice",
      instructions: "Is the statement supported?",
      criteria: {
        supported: "yes",
        contradicted: "no",
        unsupported: "unclear",
      },
    },
  },
};

test("judge answers are normalized and must match every question", () => {
  const answers = parseJudgeAnswers(
    JSON.stringify({
      answers: {
        f1: {
          choice: "supported",
          probabilities: { supported: 8, contradicted: 1, unsupported: 1 },
        },
      },
    }),
    request,
  );
  assert.equal(answers.f1.choice, "supported");
  assert.equal(answers.f1.confidence, 0.8);
  for (const bad of [
    { answers: {} },
    {
      answers: {
        f1: {
          choice: "maybe",
          probabilities: { supported: 1, contradicted: 0, unsupported: 0 },
        },
      },
    },
    {
      answers: {
        f1: {
          choice: "supported",
          probabilities: { supported: 0.1, contradicted: 0.9, unsupported: 0 },
        },
      },
    },
    {
      answers: { f1: { choice: "supported", probabilities: { supported: 1 } } },
    },
  ])
    assert.throws(
      () => parseJudgeAnswers(JSON.stringify(bad), request),
      /llm_judge_/,
    );
});

test("LLM judge retains the exact request and a decision matching its response", async () => {
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
  try {
    await migrateEnrichment(db);
    const store = new EnrichmentStore(db);
    const budgetId = randomUUID();
    await store.createBudget({
      id: budgetId,
      scope: "test",
      currency: "USD",
      capMicros: "100000",
    });
    const sent: string[] = [];
    const client: WeftTransport = {
      async fetch(req) {
        sent.push(String(req.body));
        const content = JSON.stringify({
          answers: {
            f1: {
              choice: "supported",
              probabilities: {
                supported: 0.9,
                contradicted: 0.05,
                unsupported: 0.05,
              },
            },
          },
        });
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          bodyBase64: Buffer.from(
            JSON.stringify({
              choices: [{ message: { content } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
          ).toString("base64"),
          paidUsd: "0.0001",
          heldUsd: "0",
          paymentStatus: "settled",
          txHash: null,
          artifactId: null,
          merchant: null,
        } as never;
      },
    };
    const judge = llmJudge(store, client, {
      scope: "test",
      budgetId,
      maxCostUsd: "0.01",
      policy: {
        id: "p",
        scope: "test",
        operation: "openrouter-chat-completions",
        storageVerified: true,
        retentionApproved: true,
      },
      enabled: () => true,
      model: {
        provider: "weft/openrouter",
        model: "openai/gpt-5-nano",
        revision: null,
      },
    });
    const decision = await judge({
      runId: randomUUID(),
      request,
      recipeVersion: "judge-v6",
      evidenceIds: ["e1"],
    });
    assert.equal(decision.response.answers.f1.choice, "supported");
    const retainedRequest = await store.getArtifact(decision.requestArtifactId);
    const retainedResponse = await store.getArtifact(
      decision.responseArtifactId,
    );
    assert.equal(
      Buffer.from(retainedRequest!.body).toString(),
      canonicalJson(request),
    );
    assert.equal(
      stableDigest(JSON.parse(Buffer.from(retainedResponse!.body).toString())),
      stableDigest(decision.response),
    );
    assert.equal(decision.estimatedCostMicros, "100");
    const body = JSON.parse(sent[0]);
    assert.equal(body.model, "openai/gpt-5-nano");
    assert.deepEqual(
      body.response_format.json_schema.schema.properties.answers.required,
      ["f1"],
    );
  } finally {
    await pg.close();
  }
});
