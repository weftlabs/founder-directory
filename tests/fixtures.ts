import assert from "node:assert/strict";
import { beforeEach, afterEach, mock } from "node:test";
import { WeftClient, type FetchResponse } from "@weft-labs/sdk";
import type { WeftDependencies, WeftTransport } from "../lib/weft";

// Defense in depth: a forgotten injection cannot reach the SDK or the network,
// even on a developer machine with real credentials in its environment.
beforeEach(() => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("Network forbidden in unit tests");
  });
  mock.method(WeftClient.prototype, "fetch", async () => {
    throw new Error("Real Weft client forbidden in unit tests");
  });
  mock.method(console, "warn", () => {});
});
afterEach(() => {
  mock.restoreAll();
});

export function response(status: number, body: unknown = {}): FetchResponse {
  return {
    status,
    merchant: "fixture",
    headers: {},
    bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64"),
    paidUsd: "0",
    heldUsd: "0",
    paymentStatus: "settled",
    txHash: "",
    artifactId: 1,
  } as unknown as FetchResponse;
}

export function offline(
  fetch: WeftTransport["fetch"],
  apiKey: string | undefined = "test-only",
): WeftDependencies {
  return {
    apiKey: () => apiKey,
    createClient: (key) => {
      assert.equal(key, apiKey);
      return { fetch };
    },
    sleep: async () => {},
  };
}

export const noKey: WeftDependencies = {
  apiKey: () => undefined,
  createClient: () => {
    assert.fail("No-key calls must not construct a client");
  },
};

export const placesResponse = (rows: unknown) =>
  response(200, {
    choices: [{ message: { content: JSON.stringify(rows) } }],
  });
