import assert from "node:assert/strict";
import { test } from "node:test";
import type { CollectionStore } from "../lib/enrichment/collection";
import type { RenderedAnalysisRequest } from "../lib/enrichment/contracts";
import { weftGeneration } from "../lib/enrichment/generation";
import type { WeftTransport } from "../lib/weft";

function fixture(
  provider = "weft/openrouter",
  operation = "openrouter-chat-completions",
) {
  const events: string[] = [];
  const requests: Parameters<WeftTransport["fetch"]>[0][] = [];
  const plans: Parameters<CollectionStore["planCollection"]>[0][] = [];
  const store: CollectionStore = {
    async planCollection(input) {
      plans.push(input);
      events.push("plan");
      return { id: "request" };
    },
    async getReusableArtifact() {
      return null;
    },
    async reserveAttempt() {
      events.push("reserve");
      return { id: "attempt", clientKey: "durable-key", requestId: "request" };
    },
    async markDispatched() {
      events.push("dispatch");
    },
    async markUncertain() {
      events.push("uncertain");
    },
    async captureResponse(input) {
      events.push("archive");
      return {
        id: "artifact",
        body: input.body,
        metadata: input.metadata ?? {},
      };
    },
  };
  const client: WeftTransport = {
    async fetch(request, options) {
      requests.push(request);
      events.push("fetch");
      assert.equal(options?.idempotencyKey, "durable-key");
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: "{}" } }],
            usage: { total_tokens: 12 },
          }),
        ).toString("base64"),
        paidUsd: "0.001",
        heldUsd: "0",
        paymentStatus: "settled",
        txHash: "synthetic-transaction",
        artifactId: 1,
        merchant: {
          address: "synthetic-merchant",
          settlementCount: 1,
          firstSeenAt: new Date(0),
          disputeCount: 0,
        },
      };
    },
  };
  const request: RenderedAnalysisRequest = {
    recipe: {
      purpose: "founder_dna",
      schemaVersion: "1",
      parserVersion: "1",
      promptVersion: "1",
      template: "synthetic",
      provider,
      model: "synthetic-model",
      modelRevision: "synthetic-revision",
      parameters: {
        temperature: 0,
        max_tokens: 1800,
        provider: { require_parameters: true },
      },
      responseSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      toolDefinitions: [],
      codeDigest: "fixture",
      selectionPolicy: "fixture",
    },
    messages: [{ role: "user", content: "Synthetic evidence" }],
    context: [],
    evidence: [],
  };
  const execute = weftGeneration(store, client, {
    scope: "fixture",
    budgetId: "budget",
    maxCostUsd: "0.03",
    policy: {
      id: "policy",
      scope: "fixture",
      operation,
      storageVerified: true,
      retentionApproved: true,
    },
    enabled: () => true,
  });
  return {
    events,
    requests,
    plans,
    store,
    client,
    request,
    run: () =>
      execute({ runId: "run", request, requestBytes: Buffer.from("fixture") }),
  };
}

test("OpenRouter route preserves model revision, schema and parameters through durable capture", async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(f.events, [
    "plan",
    "reserve",
    "dispatch",
    "fetch",
    "archive",
  ]);
  assert.equal(
    f.requests[0].url,
    "https://openrouter.mpp.tempo.xyz/v1/chat/completions",
  );
  assert.equal(f.requests[0].operationId, "openrouter-chat-completions");
  assert.equal(f.requests[0].accessMethodId, "mpp-access-23-0-0");
  assert.equal(f.requests[0].maxCostUsd, "0.03");
  assert.deepEqual(JSON.parse(String(f.requests[0].body)), {
    ...(f.request.recipe.parameters as object),
    model: "synthetic-revision",
    messages: f.request.messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "founder_analysis",
        strict: true,
        schema: f.request.recipe.responseSchema,
      },
    },
  });
  assert.equal(result.responseArtifactId, "artifact");
  assert.equal(result.attemptId, "attempt");
  assert.deepEqual(result.usage, { total_tokens: 12 });
  assert.equal(result.finishReason, "stop");
});

test("BlockRun uses its own reviewed route and matching policy", async () => {
  const f = fixture("weft/blockrun", "blockrun-chat-completions");
  await f.run();
  assert.equal(f.plans[0].operation, "blockrun-chat-completions");
  assert.equal(f.requests[0].operationId, "blockrun-chat-completions");
  assert.equal(
    f.requests[0].url,
    "https://blockrun.ai/api/v1/chat/completions",
  );
  assert.equal(f.requests[0].accessMethodId, "blockrun-chat-x402-base");
  assert.equal(
    JSON.parse(String(f.requests[0].body)).model,
    "synthetic-revision",
  );
});

test("an exact rendered schema takes precedence without changing the recipe schema", async () => {
  const f = fixture();
  const recipeSchema = f.request.recipe.responseSchema;
  const responseSchema = {
    type: "object",
    properties: {
      evidenceIds: {
        type: "array",
        items: { type: "string", enum: ["synthetic-evidence"] },
      },
    },
  };
  Object.assign(f.request, { responseSchema });
  await f.run();
  assert.deepEqual(
    JSON.parse(String(f.requests[0].body)).response_format.json_schema.schema,
    responseSchema,
  );
  assert.equal(f.request.recipe.responseSchema, recipeSchema);
});

test("unknown providers and mismatched route policies fail before reservation or transport", async () => {
  for (const [provider, operation, error] of [
    [
      "weft/unknown",
      "openrouter-chat-completions",
      /unsupported_model_provider/,
    ],
    ["toString", "openrouter-chat-completions", /unsupported_model_provider/],
    [
      "weft/blockrun",
      "openrouter-chat-completions",
      /collection_policy_not_approved/,
    ],
    [
      "weft/openrouter",
      "blockrun-chat-completions",
      /collection_policy_not_approved/,
    ],
  ] as const) {
    const f = fixture(provider, operation);
    await assert.rejects(f.run(), error);
    assert.deepEqual(f.events, []);
  }
});

test("ambiguous transport error is recorded once without provider fallback", async () => {
  const f = fixture();
  let calls = 0;
  f.client.fetch = async () => {
    calls++;
    throw new Error("ambiguous payment");
  };
  await assert.rejects(f.run(), /collection_uncertain/);
  assert.equal(calls, 1);
  assert.deepEqual(f.events, ["plan", "reserve", "dispatch", "uncertain"]);
});

test("paid HTTP failure is archived before rejection without fallback", async () => {
  const f = fixture("weft/blockrun", "blockrun-chat-completions");
  const fetch = f.client.fetch;
  f.client.fetch = async (...args) => ({
    ...(await fetch(...args)),
    status: 402,
  });
  await assert.rejects(f.run(), /model_http_failure_response_archived/);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.events, [
    "plan",
    "reserve",
    "dispatch",
    "fetch",
    "archive",
  ]);
});

test("tools and malformed parameters stop before any collection", async () => {
  const tools = fixture();
  tools.request.recipe.toolDefinitions = [{ type: "function" }];
  await assert.rejects(tools.run(), /tool_execution_not_enabled/);
  assert.deepEqual(tools.events, []);
  for (const parameters of [null, [], "invalid"]) {
    const f = fixture();
    f.request.recipe.parameters = parameters;
    await assert.rejects(f.run(), /invalid_model_parameters/);
    assert.deepEqual(f.events, []);
  }
});
