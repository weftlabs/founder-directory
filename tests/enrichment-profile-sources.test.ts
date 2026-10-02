import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CapturedArtifact,
  CollectionStore,
} from "../lib/enrichment/collection";
import type { WeftTransport } from "../lib/weft";
import { workerAdapters } from "../lib/enrichment/worker-runtime";
import { extractProfile } from "../lib/enrichment/worker";

const policy = (operation: string) => ({
  id: operation,
  scope: "test",
  operation,
  storageVerified: true,
  retentionApproved: true,
});

function harness(
  responses: Record<string, { status: number; paidUsd: string }>,
) {
  const saved = new Map<string, CapturedArtifact>();
  const calls: { url: string; operationId?: string }[] = [];
  let request = 0;
  const store: CollectionStore = {
    planCollection: async (value) => ({ id: value.fingerprint }),
    getReusableArtifact: async (id) => saved.get(id) ?? null,
    reserveAttempt: async ({ requestId }) => ({
      id: requestId,
      clientKey: `key-${request++}`,
      requestId,
    }),
    markDispatched: async () => undefined,
    markUncertain: async () => undefined,
    captureResponse: async (value) => {
      const artifact = {
        id: value.attemptId,
        body: value.body,
        metadata: value.metadata ?? {},
      };
      saved.set(value.attemptId, artifact);
      return artifact;
    },
  };
  const client: WeftTransport = {
    fetch: async (req) => {
      calls.push({ url: req.url, operationId: req.operationId });
      const host = new URL(req.url).host;
      const { status, paidUsd } = responses[host];
      return {
        status,
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from("{}").toString("base64"),
        paidUsd,
        heldUsd: "0",
        paymentStatus: paidUsd === "0" ? "pending" : "settled",
        txHash: null,
        artifactId: null,
        merchant: null,
      } as never;
    },
  };
  const adapters = workerAdapters(
    store,
    client,
    {
      scope: "test",
      budgetId: "budget",
      generation: 0,
      policies: {
        "twitsh-user-by-username": policy("twitsh-user-by-username"),
        "bazaar-x402-atlas-183": policy("bazaar-x402-atlas-183"),
      },
      sourceMaxCostUsd: "0.01",
      modelMaxCostUsd: "0.01",
    },
    () => true,
  );
  const collect = () =>
    adapters.collectProfile({
      entityId: "founder",
      legacyKey: "builder",
      generation: 0,
    });
  return { collect, calls };
}

test("profile sources run cheapest first and stop on success", async () => {
  const h = harness({
    "x402.twit.sh": { status: 200, paidUsd: "0.005" },
    "twitter.use.x402atlas.com": { status: 200, paidUsd: "0.006" },
  });
  assert.equal((await h.collect()).status, "captured");
  assert.deepEqual(h.calls, [
    {
      url: "https://x402.twit.sh/users/by/username?username=builder",
      operationId: undefined,
    },
  ]);
  // A repeat is served from the archive, never bought again.
  assert.equal((await h.collect()).status, "captured");
  assert.equal(h.calls.length, 1);
});

test("an uncharged failure falls back; a charged failure never buys again", async () => {
  const fallback = harness({
    "x402.twit.sh": { status: 500, paidUsd: "0" },
    "twitter.use.x402atlas.com": { status: 200, paidUsd: "0.006" },
  });
  assert.equal((await fallback.collect()).status, "captured");
  assert.deepEqual(
    fallback.calls.map((call) => call.operationId),
    [undefined, "bazaar-x402-atlas-183"],
  );

  const charged = harness({
    "x402.twit.sh": { status: 500, paidUsd: "0.005" },
    "twitter.use.x402atlas.com": { status: 200, paidUsd: "0.006" },
  });
  const result = await charged.collect();
  assert.equal(result.status, "unavailable");
  assert.equal(charged.calls.length, 1);
});

test("X v2 (twit.sh) profiles parse identity, bio, location and one profile URL", () => {
  const profile = (data: Record<string, unknown>) =>
    extractProfile(Buffer.from(JSON.stringify({ data })));
  const base = {
    id: "1",
    name: "Builder",
    username: "builder",
    description: "Builds tools",
    location: "Lisbon",
    protected: false,
  };
  const entry = {
    url: "https://t.co/x",
    expanded_url: "https://product.example/",
  };
  assert.deepEqual(profile({ ...base, entities: { url: { urls: [entry] } } }), {
    status: "available",
    payload: {
      name: "Builder",
      handle: "builder",
      bio: "Builds tools",
      website: "https://product.example/",
      location: "Lisbon",
    },
    sourceUrl: "https://x.com/builder",
  });
  for (const urls of [[], [entry, entry]]) {
    const result = profile({ ...base, entities: { url: { urls } } });
    assert.equal(result.status === "available" && result.payload.website, null);
  }
  assert.deepEqual(profile({ ...base, protected: true }), {
    status: "unavailable",
    reason: "protected_account",
  });
  assert.throws(
    () => profile({ ...base, name: "" }),
    /profile_identity_missing/,
  );
});
