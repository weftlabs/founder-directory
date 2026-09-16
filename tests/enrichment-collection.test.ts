import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectResponse,
  type CollectionStore,
} from "../lib/enrichment/collection";

function fixture() {
  const events: string[] = [];
  let saved: {
    id: string;
    body: Uint8Array;
    metadata: Record<string, unknown>;
  } | null = null;
  const store: CollectionStore = {
    planCollection: async () => {
      events.push("plan");
      return { id: "request" };
    },
    getReusableArtifact: async () => saved,
    reserveAttempt: async () => {
      events.push("reserve");
      return { id: "attempt", clientKey: "durable-key", requestId: "request" };
    },
    markDispatched: async () => {
      events.push("dispatch");
    },
    markUncertain: async () => {
      events.push("uncertain");
    },
    captureResponse: async (value) => {
      events.push("archive");
      saved = {
        id: "artifact",
        body: value.body,
        metadata: value.metadata ?? {},
      };
      return saved;
    },
  };
  const input = {
    scope: "fixture",
    generation: 1,
    budgetId: "budget",
    operation: "test-v1",
    args: { handle: "synthetic" },
    capMicros: "10000",
    mode: "acquire" as const,
    policy: {
      id: "fixture-v1",
      scope: "fixture",
      operation: "test-v1",
      storageVerified: true,
      retentionApproved: true,
    },
  };
  return { store, input, events };
}

test("capture precedes parsing and replay never dispatches", async () => {
  const { store, input, events } = fixture();
  let calls = 0;
  const dispatch = async (key: string) => {
    assert.equal(key, "durable-key");
    calls++;
    return {
      body: Buffer.from("not JSON"),
      status: 502,
      contentType: "application/json",
      paymentStatus: "pending",
      paidUsd: "0.00",
      heldUsd: "0.01",
    };
  };
  const first = await collectResponse(store, input, dispatch);
  assert.equal(Buffer.from(first.body).toString(), "not JSON");
  assert.deepEqual(events, ["plan", "reserve", "dispatch", "archive"]);
  await collectResponse(store, { ...input, mode: "replay" }, dispatch);
  assert.equal(calls, 1);
});

test("missing replay input and unapproved capture do not dispatch", async () => {
  const { store, input, events } = fixture();
  const dispatch = async (): Promise<never> => {
    throw new Error("must not dispatch");
  };
  await assert.rejects(
    collectResponse(store, { ...input, mode: "replay" }, dispatch),
    /missing_input/,
  );
  await assert.rejects(
    collectResponse(
      store,
      { ...input, policy: { ...input.policy, retentionApproved: false } },
      dispatch,
    ),
    /policy/,
  );
  assert.ok(!events.includes("reserve"));
});

test("ambiguous transport failure becomes uncertain without a retry", async () => {
  const { store, input, events } = fixture();
  let calls = 0;
  await assert.rejects(
    collectResponse(store, input, async () => {
      calls++;
      throw new Error("secret-bearing transport error");
    }),
    /collection_uncertain/,
  );
  assert.equal(calls, 1);
  assert.equal(events.at(-1), "uncertain");
});

test("bad payment metadata does not discard the received body", async () => {
  const { store, input } = fixture();
  const result = await collectResponse(store, input, async () => ({
    body: Buffer.from("paid data"),
    status: 200,
    contentType: "text/plain",
    paymentStatus: "settled",
    paidUsd: "broken",
  }));
  assert.equal(Buffer.from(result.body).toString(), "paid data");
  assert.equal(result.metadata.paymentState, "uncertain");
});

test("capture failure stops and leaves an uncertain attempt", async () => {
  const { store, input, events } = fixture();
  store.captureResponse = async () => {
    throw new Error("storage unavailable");
  };
  await assert.rejects(
    collectResponse(store, input, async () => ({
      body: Buffer.from("data"),
      status: 200,
      contentType: "text/plain",
      paymentStatus: "settled",
      paidUsd: "0.01",
    })),
    /collection_uncertain/,
  );
  assert.equal(events.at(-1), "uncertain");
});
