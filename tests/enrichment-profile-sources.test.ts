import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CapturedArtifact,
  CollectionStore,
} from "../lib/enrichment/collection";
import type { WeftTransport } from "../lib/weft";
import { workerAdapters } from "../lib/enrichment/worker-runtime";
import { extractProfile, extractTweets } from "../lib/enrichment/worker";

// Readable bodies per provider; "{}" stands for a success we cannot parse.
const BODIES: Record<string, unknown> = {
  "x402factory.ai": {
    ok: true,
    profile: { name: "Builder", screen_name: "builder", description: "Builds" },
    tweets: [{ id: "1", text: "Shipped v2 today", created_at: "2026-10-01" }],
  },
  "x402.twit.sh": { data: { name: "Builder", username: "builder" } },
  "twitter.use.x402atlas.com": {
    data: { core: { name: "Builder", screen_name: "builder" } },
  },
};

const policy = (operation: string) => ({
  id: operation,
  scope: "test",
  operation,
  storageVerified: true,
  retentionApproved: true,
});

function harness(
  responses: Record<
    string,
    { status: number; paidUsd: string; body?: unknown }
  >,
  sources = ["twitsh-user-by-username", "bazaar-x402-atlas-183"],
) {
  const saved = new Map<string, CapturedArtifact>();
  const calls: { url: string; operationId?: string; body?: unknown }[] = [];
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
      calls.push({
        url: req.url,
        operationId: req.operationId,
        body: req.body,
      });
      const host = new URL(req.url).host;
      const { status, paidUsd, body = BODIES[host] } = responses[host];
      return {
        status,
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64"),
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
      policies: Object.fromEntries(sources.map((op) => [op, policy(op)])),
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
      body: undefined,
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

test("x402factory runs first as a POST; an unreadable paid success falls back", async () => {
  const sources = ["x402factory-xprofile", "bazaar-x402-atlas-183"];
  const ok = harness(
    {
      "x402factory.ai": { status: 200, paidUsd: "0.001" },
      "twitter.use.x402atlas.com": { status: 200, paidUsd: "0.006" },
    },
    sources,
  );
  assert.equal((await ok.collect()).status, "captured");
  assert.deepEqual(ok.calls, [
    {
      url: "https://x402factory.ai/base/xprofile",
      operationId: undefined,
      body: JSON.stringify({ handle: "builder" }),
    },
  ]);

  const unreadable = harness(
    {
      "x402factory.ai": { status: 200, paidUsd: "0.001", body: {} },
      "twitter.use.x402atlas.com": { status: 200, paidUsd: "0.006" },
    },
    sources,
  );
  assert.equal((await unreadable.collect()).status, "captured");
  assert.deepEqual(
    unreadable.calls.map((call) => call.operationId),
    [undefined, "bazaar-x402-atlas-183"],
  );
});

test("x402factory profiles parse flat and nested upstream shapes", () => {
  const parse = (profile: unknown) =>
    extractProfile(Buffer.from(JSON.stringify({ ok: true, profile })));
  assert.deepEqual(
    parse({
      name: "Builder",
      screen_name: "builder",
      description: "Builds",
      location: "Lisbon",
      entities: {
        url: { urls: [{ expanded_url: "https://product.example/" }] },
      },
    }),
    {
      status: "available",
      payload: {
        name: "Builder",
        handle: "builder",
        bio: "Builds",
        website: "https://product.example/",
        location: "Lisbon",
      },
      sourceUrl: "https://x.com/builder",
    },
  );
  assert.equal(
    parse({ core: { name: "Builder", screen_name: "builder" } }).status,
    "available",
  );
  assert.throws(() => parse({ name: "Builder" }), /profile_identity_missing/);
  assert.throws(
    () => extractProfile(Buffer.from(JSON.stringify({ ok: false }))),
    /profile_schema_invalid/,
  );
});

test("tweets keep only the founder's own posts, never reposts", () => {
  const atlas = {
    data: [
      {
        id_str: "1",
        full_text: "Shipped",
        created_at: "x",
        user: { core: { screen_name: "Builder" } },
      },
      {
        id_str: "2",
        full_text: "RT @other: hi",
        user: { core: { screen_name: "builder" } },
      },
      {
        id_str: "3",
        full_text: "Not mine",
        user: { core: { screen_name: "other" } },
      },
      { id_str: "4", full_text: "No author" },
      {
        id_str: "5",
        full_text: "Quoted",
        retweeted_status_result: {},
        user: { core: { screen_name: "builder" } },
      },
    ],
  };
  assert.deepEqual(
    extractTweets(Buffer.from(JSON.stringify(atlas)), "builder"),
    [{ id: "1", text: "Shipped", createdAt: "x" }],
  );
  const factory = {
    ok: true,
    tweets: [
      { id: "7", text: "Building in public", created_at: null },
      { id: "8", text: "x", author: { screen_name: "other" } },
    ],
  };
  assert.deepEqual(
    extractTweets(Buffer.from(JSON.stringify(factory)), "builder"),
    [{ id: "7", text: "Building in public", createdAt: null }],
  );
  // Profile-only bodies carry no tweet list.
  for (const body of Object.values(BODIES).slice(1))
    assert.equal(
      extractTweets(Buffer.from(JSON.stringify(body)), "builder"),
      null,
    );
});
