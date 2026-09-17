import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CollectionStore,
  CapturedArtifact,
} from "../lib/enrichment/collection";
import type { WeftTransport } from "../lib/weft";
import { collectWebsite } from "../lib/enrichment/website";

const url = "https://product.example/about";
function fixture(payload: unknown, status = 200) {
  let saved: CapturedArtifact | null = null;
  let calls = 0;
  const store: CollectionStore = {
    planCollection: async () => ({ id: "request" }),
    getReusableArtifact: async () => saved,
    reserveAttempt: async () => ({
      id: "attempt",
      clientKey: "key",
      requestId: "request",
    }),
    markDispatched: async () => undefined,
    markUncertain: async () => undefined,
    captureResponse: async (value) => {
      saved = {
        id: "artifact",
        body: value.body,
        metadata: value.metadata ?? {},
      };
      return saved;
    },
  };
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const client: WeftTransport = {
    fetch: async (request) => {
      calls++;
      assert.equal(request.url, "https://api.exa.ai/contents");
      assert.deepEqual(JSON.parse(request.body as string), {
        urls: [url],
        text: true,
      });
      assert.equal(request.operationId, "exa-contents");
      assert.equal(request.accessMethodId, "exa-contents-x402-base");
      return {
        status,
        headers: { "content-type": "application/json" },
        bodyBase64: Buffer.from(raw).toString("base64"),
        paidUsd: "0.001",
        heldUsd: "0",
        paymentStatus: "settled",
        txHash: "synthetic",
        artifactId: 1,
        merchant: {
          address: "synthetic",
          settlementCount: 1,
          firstSeenAt: new Date(0),
          disputeCount: 0,
        },
      };
    },
  };
  const input = {
    websiteUrl: url,
    sourceProfileArtifactId: "profile-artifact",
    scope: "test",
    generation: 0,
    mode: "acquire" as const,
    budgetId: "budget",
    maxCostUsd: "0.001",
    maxExcerptChars: 20,
    policy: {
      id: "policy",
      scope: "test",
      operation: "exa-contents",
      storageVerified: true,
      retentionApproved: true,
    },
  };
  return { store, client, input, raw, saved: () => saved, calls: () => calls };
}
const response = () => ({
  statuses: [{ id: url, status: "success" }],
  results: [
    {
      id: url,
      url,
      text: "Useful product source text with more detail.",
      publishedDate: "2026-01-01",
    },
  ],
});

test("website captures exact response, then extracts capped source text; replay never dispatches", async () => {
  const f = fixture(response());
  const result = await collectWebsite(f.store, f.client, f.input, () => true);
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.equal(Buffer.from(result.artifact.body).toString(), f.raw);
  assert.equal(result.artifact.metadata.sourceKind, "product-site");
  assert.equal(typeof result.artifact.metadata.observedAt, "string");
  assert.equal(result.artifact.metadata.requestedUrl, url);
  assert.equal(result.text, "Useful product sourc");
  assert.equal(result.provenance.truncated, true);
  assert.equal(result.provenance.publishedDate, "2026-01-01");
  assert.equal(result.provenance.sourceProfileArtifactId, "profile-artifact");
  await collectWebsite(
    f.store,
    f.client,
    { ...f.input, mode: "replay" },
    () => false,
  );
  assert.equal(f.calls(), 1);
});

test("invalid bodies, per-URL failures, missing text and unrelated URLs remain archived but unavailable", async () => {
  const cases: unknown[] = [
    "not json",
    null,
    {},
    { results: response().results },
    { ...response(), statuses: [{ id: url, status: "error" }] },
    {
      ...response(),
      results: [{ id: url, url, summary: "Generated text is not evidence" }],
    },
    {
      ...response(),
      results: [
        { id: url, url: "https://other.example/", text: "Wrong owner" },
      ],
    },
    {
      ...response(),
      statuses: [{ id: "https://other.example/", status: "success" }],
    },
  ];
  for (const payload of cases) {
    const f = fixture(payload);
    assert.equal(
      (await collectWebsite(f.store, f.client, f.input, () => true)).status,
      "unavailable",
    );
    assert.equal(Buffer.from(f.saved()!.body).toString(), f.raw);
  }
  const f = fixture(response(), 502);
  assert.equal(
    (await collectWebsite(f.store, f.client, f.input, () => true)).status,
    "unavailable",
  );
});

test("unsafe or unproven profile URLs never dispatch", async () => {
  for (const websiteUrl of [
    "file:///tmp/a",
    "http://localhost/",
    "http://127.1/",
    "http://[::1]/",
    "http://10.0.0.1/",
    "http://metadata.google.internal/",
    "https://user:pass@product.example/",
    "https://product.example/?token=secret",
    "https://intranet/",
    "https://product.local/",
    "https://product.example:8443/",
  ]) {
    const f = fixture(response());
    assert.equal(
      (
        await collectWebsite(
          f.store,
          f.client,
          { ...f.input, websiteUrl },
          () => true,
        )
      ).status,
      "unavailable",
    );
    assert.equal(f.calls(), 0);
  }
  const f = fixture(response());
  assert.equal(
    (
      await collectWebsite(
        f.store,
        f.client,
        { ...f.input, sourceProfileArtifactId: "" },
        () => true,
      )
    ).status,
    "unavailable",
  );
  assert.equal(f.calls(), 0);
});

test("missing replay and disabled collection do not dispatch", async () => {
  const f = fixture(response());
  await assert.rejects(
    collectWebsite(
      f.store,
      f.client,
      { ...f.input, mode: "replay" },
      () => true,
    ),
    /missing_input/,
  );
  await assert.rejects(
    collectWebsite(f.store, f.client, f.input, () => false),
    /collection_disabled/,
  );
  assert.equal(f.calls(), 0);
});

test("ambiguous paid transport failures propagate without retry; policies and limits gate dispatch", async () => {
  const f = fixture(response());
  let attempts = 0;
  const client: WeftTransport = {
    fetch: async () => {
      attempts++;
      throw new Error("timeout");
    },
  };
  await assert.rejects(
    collectWebsite(f.store, client, f.input, () => true),
    /collection_uncertain/,
  );
  assert.equal(attempts, 1);
  await assert.rejects(
    collectWebsite(
      f.store,
      f.client,
      { ...f.input, policy: { ...f.input.policy, retentionApproved: false } },
      () => true,
    ),
    /collection_policy_not_approved/,
  );
  await assert.rejects(
    collectWebsite(
      f.store,
      f.client,
      { ...f.input, maxExcerptChars: 100001 },
      () => true,
    ),
    /invalid_website_excerpt_limit/,
  );
  assert.equal(f.calls(), 0);
});

test("duplicate results and duplicate statuses fail closed", async () => {
  for (const payload of [
    { ...response(), results: [...response().results, ...response().results] },
    {
      ...response(),
      statuses: [...response().statuses, ...response().statuses],
    },
  ]) {
    const f = fixture(payload);
    assert.equal(
      (await collectWebsite(f.store, f.client, f.input, () => true)).status,
      "unavailable",
    );
  }
});
