import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { WeftError } from "@weft-labs/sdk";
import { fetchWithRetry } from "../lib/weft-retry";
import { response } from "./fixtures";

const request = { url: "https://example.invalid", maxCostUsd: "0.002" };
const error = (
  status: number,
  retryable = false,
  code = "upstream_error",
  details?: Record<string, unknown>,
) => new WeftError({ status, retryable, code, details, message: "test" });

test("502/504 recover with bounded backoff and unchanged request/cap/key", async () => {
  const calls: unknown[] = [],
    delays: number[] = [],
    keys: (string | undefined)[] = [];
  let i = 0;
  const client = {
    fetch: async (r: typeof request, o?: { idempotencyKey?: string }) => {
      calls.push({ r, o });
      keys.push(o?.idempotencyKey);
      return response([502, 504, 200][i++] ?? 200);
    },
  };
  assert.equal(
    (
      await fetchWithRetry(client, request, async (ms) => {
        delays.push(ms);
      })
    )?.status,
    200,
  );
  assert.deepEqual(delays, [500, 1000]);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[1], calls[2]);
  assert.match(keys[0]!, /^[0-9a-f-]{36}$/);
  await fetchWithRetry(client, request);
  assert.notEqual(keys[0], keys[3], "separate requests need separate keys");
});

test("exhausted status retries make exactly three calls and two sleeps", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await fetchWithRetry(
    {
      fetch: async () => {
        calls++;
        return response(502);
      },
    },
    request,
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.equal(result, null);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test("WeftErrors retry only eligible failures; hard stops override retryable", async () => {
  const cases: [unknown, number][] = [
    [error(502), 3],
    [error(504), 3],
    [error(503, true), 3],
    [error(400), 1],
    [error(503), 1],
    [new Error("ambiguous timeout"), 1],
    ...[401, 402, 403].map(
      (status) => [error(status, true), 1] as [unknown, number],
    ),
    ...[
      "balance_low",
      "budget_exceeded",
      "policy_denied",
      "denylist",
      "price_cap_exceeded",
      "cost_limit",
      "scope_missing",
      "auth_failed",
      "payment_pending",
    ].map((code) => [error(502, true, code), 1] as [unknown, number]),
  ];
  for (const [err, count] of cases) {
    let calls = 0,
      sleeps = 0;
    assert.equal(
      await fetchWithRetry(
        {
          fetch: async () => {
            calls++;
            throw err;
          },
        },
        request,
        async () => {
          sleeps++;
        },
      ),
      null,
    );
    assert.equal(calls, count);
    assert.equal(sleeps, count - 1);
  }
});

test("non-transient HTTP statuses are returned without retry", async () => {
  for (const status of [200, 400, 401, 402, 403, 429, 500, 503]) {
    let calls = 0;
    assert.equal(
      (
        await fetchWithRetry(
          {
            fetch: async () => {
              calls++;
              return response(status);
            },
          },
          request,
          async () => assert.fail("unexpected sleep"),
        )
      )?.status,
      status,
    );
    assert.equal(calls, 1);
  }
});

test("held/paid/pending or ambiguous receipts are not replayed, including nested aliases", async () => {
  const details = [
    { paymentStatus: "pending" },
    { payment_status: "paid" },
    { paymentStatus: "held" },
    { heldUsd: "0.001" },
    { paid_usd: "0.001" },
    { paidUsd: "0", paid_usd: "1" },
    { heldUsd: "0", held_usd: "1" },
    { receipt: { paidUsd: "1" } },
    { receipts: [{ held_usd: "0.01" }] },
    { paidUsd: "unknown" },
    { heldUsd: null },
  ];
  for (const detail of details) {
    for (const throwing of [false, true]) {
      let calls = 0;
      await fetchWithRetry(
        {
          fetch: async () => {
            calls++;
            if (throwing) throw error(504, true, "upstream_error", detail);
            return { ...response(502), ...detail } as ReturnType<
              typeof response
            >;
          },
        },
        request,
        async () => assert.fail("committed receipt must never sleep"),
      );
      assert.equal(calls, 1, JSON.stringify(detail));
    }
  }
});

test("failure diagnostics never log keys, response bodies, error messages or details", async () => {
  const secret = "fixture-secret-do-not-log";
  const logs: unknown[][] = [];
  mock.method(console, "warn", (...args: unknown[]) => {
    logs.push(args);
  });
  await fetchWithRetry(
    {
      fetch: async () => {
        throw new WeftError({
          status: 403,
          retryable: true,
          code: secret,
          message: secret,
          requestId: secret,
          details: { secret },
        });
      },
    },
    { ...request, headers: { authorization: secret } },
  );
  await fetchWithRetry(
    { fetch: async () => ({ ...response(502, { secret }), heldUsd: "1" }) },
    request,
  );
  assert.equal(logs.length, 2);
  assert.equal(JSON.stringify(logs).includes(secret), false);
  assert.deepEqual(
    logs.map((row) => row[1]),
    [
      { status: 403, attempt: 1 },
      { status: 502, attempt: 1 },
    ],
  );
});
