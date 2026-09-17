import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CollectionStore,
  CapturedArtifact,
} from "../lib/enrichment/collection";
import type { WeftTransport } from "../lib/weft";
import {
  collectWebsite,
  parseWebsiteArtifact,
} from "../lib/enrichment/website";
import { collectWeft } from "../lib/enrichment/weft-transport";
import { workerAdapters } from "../lib/enrichment/worker-runtime";

test("Jina archives free JSON before parsing and replays without dispatch", async () => {
  const raw = {
    code: 200,
    data: {
      url,
      content: "Public product page source text",
      publishedTime: "2026-09-01",
    },
  };
  const f = fixture(raw);
  const planned: unknown[] = [];
  f.store.planCollection = async (value) => {
    planned.push(value.args);
    return { id: "request" };
  };
  let calls = 0;
  const client: WeftTransport = {
    fetch: async () => {
      throw new Error("free Jina must not use paid gateway");
    },
  };
  const freeFetch: typeof fetch = async (target, request) => {
    calls++;
    assert.equal(target, `https://r.jina.ai/${url}`);
    assert.equal(request?.method, "GET");
    assert.equal(request?.redirect, "manual");
    assert.equal(request?.credentials, "omit");
    assert.ok(request?.signal instanceof AbortSignal);
    assert.deepEqual(request?.headers, {
      Accept: "application/json",
      "X-No-Cache": "true",
      "X-Robots-Txt": "FounderDirectory",
      DNT: "true",
    });
    return new Response(JSON.stringify(raw), { status: 200 });
  };
  const input = {
    ...f.input,
    provider: "jina" as const,
    maxCostUsd: "0",
    policy: { ...f.input.policy, operation: "local-reviewed-jina-reader" },
  };
  const result = await collectWebsite(
    f.store,
    client,
    input,
    () => true,
    undefined,
    freeFetch,
  );
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.equal(result.artifact.metadata.websiteProvider, "jina");
  assert.equal(result.provenance.extractorVersion, "jina-text-v1");
  assert.equal(result.provenance.truncated, true);
  assert.equal(result.provenance.publishedDate, "2026-09-01");
  assert.deepEqual(
    JSON.parse(Buffer.from(result.artifact.body).toString()),
    raw,
  );
  await collectWebsite(
    f.store,
    client,
    { ...input, mode: "replay" },
    () => false,
    undefined,
    freeFetch,
  );
  assert.equal(calls, 1);
  const adapters = workerAdapters(
    f.store,
    client,
    {
      scope: "test",
      budgetId: "budget",
      generation: 0,
      policies: { "local-reviewed-jina-reader": input.policy },
      websiteMaxCostUsd: "0",
      sourceMaxCostUsd: "0.001",
      modelMaxCostUsd: "0.001",
    },
    () => true,
  );
  assert.equal(
    (
      await adapters.collectWebsite({
        entityId: "founder",
        generation: 0,
        provider: "jina",
        websiteUrl: url,
        sourceProfileArtifactId: "profile-artifact",
      })
    ).status,
    "captured",
  );
  assert.deepEqual((planned[0] as { headers: unknown }).headers, {
    Accept: "application/json",
    "X-No-Cache": "true",
    "X-Robots-Txt": "FounderDirectory",
    DNT: "true",
  });
  for (const payload of [
    { code: 500, data: raw.data },
    { code: 200, data: { url, summary: "not source" } },
    { code: 200, data: { url: "https://other.example/", content: "wrong" } },
    null,
  ]) {
    assert.equal(
      parseWebsiteArtifact(
        { ...result.artifact, body: Buffer.from(JSON.stringify(payload)) },
        input,
      ).status,
      "unavailable",
    );
  }
  assert.equal(
    parseWebsiteArtifact(result.artifact, { ...input, provider: "exa" }).status,
    "unavailable",
  );
  await assert.rejects(
    collectWebsite(
      f.store,
      client,
      { ...input, maxCostUsd: "0.001" },
      () => true,
    ),
    /jina_requires_zero_cap/,
  );
  const invalidHeaders: Record<string, string>[] = [
    { DNT: "false" },
    { "X-No-Cache": "false" },
    { "X-Robots-Txt": "OtherBot" },
    { Authorization: "secret" },
  ];
  for (const headers of invalidHeaders) {
    await assert.rejects(
      collectWeft(
        f.store,
        client,
        {
          scope: "test",
          budgetId: "budget",
          generation: 0,
          mode: "acquire",
          policy: input.policy,
          operation: "local-reviewed-jina-reader",
        },
        {
          url: `https://r.jina.ai/${url}`,
          headers,
          maxCostUsd: "0",
          operationId: "local-reviewed-jina-reader",
        },
        () => true,
      ),
      /unsupported_collection_header/,
    );
  }
  assert.equal(calls, 1);
  for (const status of [302, 403, 500]) {
    const failure = fixture("upstream error", status);
    const result = await collectWebsite(
      failure.store,
      client,
      input,
      () => true,
      undefined,
      async () => new Response("upstream error", { status }),
    );
    assert.equal(result.status, "unavailable");
    assert.equal(
      Buffer.from(failure.saved()!.body).toString(),
      "upstream error",
    );
  }
  const networkFailure = fixture(null);
  let attempts = 0;
  await assert.rejects(
    collectWebsite(
      networkFailure.store,
      client,
      input,
      () => true,
      undefined,
      async () => {
        attempts++;
        throw new Error("network_timeout");
      },
    ),
    /collection_uncertain/,
  );
  assert.equal(attempts, 1);
  assert.equal(networkFailure.saved(), null);
});

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
