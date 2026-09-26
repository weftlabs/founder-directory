import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedWeftClient } from "../lib/enrichment/runtime";

for (const timeoutMs of [undefined, 150000]) {
  test(`SDK requests preserve explicit timeout ${timeoutMs ?? "default"} without retries`, async (t) => {
    const controller = new AbortController();
    const deadlines: number[] = [];
    let calls = 0;
    t.mock.method(AbortSignal, "timeout", (ms: number) => {
      deadlines.push(ms);
      return controller.signal;
    });
    t.mock.method(
      globalThis,
      "fetch",
      async (_input: unknown, init?: RequestInit) => {
        calls++;
        assert.ok(init?.signal);
        controller.abort(new Error("synthetic deadline"));
        assert.equal(init.signal.aborted, true);
        throw init.signal.reason;
      },
    );
    const client = boundedWeftClient("synthetic-key", timeoutMs);
    await assert.rejects(
      client.fetch(
        { url: "https://example.test/fixture", maxCostUsd: "0.01" },
        { idempotencyKey: "synthetic-key" },
      ),
    );
    assert.deepEqual(deadlines, [timeoutMs ?? 25000]);
    assert.equal(calls, 1);
  });
}

test("invalid timeout limits fail at construction", () => {
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 150001]) {
    assert.throws(
      () => boundedWeftClient("synthetic-key", timeoutMs),
      /invalid_weft_timeout/,
    );
  }
});
