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
    markNotCharged: async () => {
      events.push("not_charged");
    },
    resumeUncertainAttempt: async () => null,
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

test("terminal failed payment releases reservation despite historical nominal hold", async () => {
  const { store, input } = fixture();
  const result = await collectResponse(store, input, async () => ({
    body: Buffer.from("declined response"),
    status: 402,
    contentType: "text/plain",
    paymentStatus: "expired",
    paidUsd: "0.00",
    heldUsd: "0.01",
  }));
  assert.equal(result.metadata.paymentState, "not_charged");
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

const weftError = (status: number, code: string) =>
  Object.assign(new Error(`Weft API returned HTTP ${status}`), {
    status,
    code,
  });

test("Weft refusals before payment are not charged", async () => {
  for (const [status, code] of [
    [402, "EXCEEDED_MAX_COST"],
    [424, "MERCHANT_RETURNED_NON_402"],
    [403, "POLICY_VIOLATION_DAILY"],
  ] as const) {
    const { store, input, events } = fixture();
    await assert.rejects(
      collectResponse(store, input, async () => {
        throw weftError(status, code);
      }),
      /collection_not_charged/,
    );
    assert.equal(events.at(-1), "not_charged", code);
  }
});

test("failures that may follow payment stay uncertain", async () => {
  for (const error of [
    weftError(424, "PAID_DELIVERY_FAILED"),
    weftError(504, "HTTP_504"),
    weftError(0, "NETWORK_ERROR"),
    weftError(409, "IDEMPOTENCY_CONFLICT"),
    weftError(402, "SETTLEMENT_FAILED"),
  ]) {
    const { store, input, events } = fixture();
    await assert.rejects(
      collectResponse(store, input, async () => {
        throw error;
      }),
      /collection_uncertain/,
    );
    assert.equal(events.at(-1), "uncertain", error.code);
  }
});

test("disabling collection before dispatch is not charged", async () => {
  const { store, input, events } = fixture();
  let checks = 0;
  await assert.rejects(
    collectResponse(store, input, async () => assert.fail("dispatched"), {
      enabled: () => ++checks === 1,
    }),
    /collection_disabled/,
  );
  assert.equal(events.at(-1), "not_charged");
});

test("resuming reuses the uncertain key and never reserves a new attempt", async () => {
  const { store, input, events } = fixture();
  store.resumeUncertainAttempt = async (value) => {
    assert.deepEqual(value, { requestId: "request", capMicros: "10000" });
    events.push("resume");
    return { id: "attempt", clientKey: "original-key" };
  };
  const keys: string[] = [];
  const result = await collectResponse(
    store,
    input,
    async (key) => {
      keys.push(key);
      return {
        body: Buffer.from("replayed"),
        status: 200,
        contentType: "text/plain",
        paymentStatus: "settled",
        paidUsd: "0.001",
        heldUsd: null,
      };
    },
    { resumeUncertain: true },
  );
  assert.deepEqual(keys, ["original-key"]);
  assert.deepEqual(events, ["plan", "resume", "archive"]);
  assert.equal(Buffer.from(result.body).toString(), "replayed");
});

test("a resumed attempt is never released by a refusal", async () => {
  const { store, input, events } = fixture();
  store.resumeUncertainAttempt = async () => ({
    id: "attempt",
    clientKey: "original-key",
  });
  await assert.rejects(
    collectResponse(
      store,
      input,
      async () => {
        throw weftError(402, "EXCEEDED_MAX_COST");
      },
      { resumeUncertain: true },
    ),
    /collection_uncertain/,
  );
  assert.equal(events.at(-1), "uncertain");
});
