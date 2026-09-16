import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchProfile,
  ProfileUnavailableError,
  searchIntroPage,
  searchIntroPages,
} from "../lib/x";
import { noKey, offline, response } from "./fixtures";

test("profile and search with no key do not construct a client", async () => {
  assert.equal(await fetchProfile("alice", null, null, noKey), null);
  await assert.rejects(
    searchIntroPage(undefined, noKey),
    /WEFT_API_KEY is not set/,
  );
});

test("profile rejects unavailable or malformed upstream data", async () => {
  for (const fixture of [
    response(403),
    response(200, null),
    response(200, []),
    response(200),
    response(200, { data: [] }),
    response(200, { data: { core: { name: 42 } } }),
    {
      ...response(200),
      bodyBase64: Buffer.from("bad JSON").toString("base64"),
    },
  ]) {
    assert.equal(
      await fetchProfile(
        "alice",
        null,
        null,
        offline(async () => fixture),
      ),
      null,
    );
  }
});

test("protected profiles are not collected", async () => {
  const payload = {
    data: {
      core: { name: "Private", screen_name: "private" },
      privacy: { protected: true },
    },
  };
  assert.equal(
    await fetchProfile(
      "private",
      null,
      null,
      offline(async () => response(200, payload)),
    ),
    null,
  );
});

test("paid upstream profile failures are exposed for intro-only fallback", async () => {
  await assert.rejects(
    fetchProfile(
      "alice",
      "I'm a solo founder",
      "123",
      offline(async () => ({
        ...response(502),
        heldUsd: "0.005",
        paymentStatus: "pending",
      })),
    ),
    (error: unknown) =>
      error instanceof ProfileUnavailableError && error.status === 502,
  );
});

test("profile hydration does not retry a transient paid response", async () => {
  let calls = 0;
  await assert.rejects(
    fetchProfile(
      "alice",
      "I'm a solo founder",
      "123",
      offline(async () => {
        calls += 1;
        return response(504);
      }),
    ),
    ProfileUnavailableError,
  );
  assert.equal(calls, 1);
});

test("profile recovery extracts model fields without inventing geography", async () => {
  let calls = 0;
  const profile = await fetchProfile(
    "alice",
    "intro linkedin.com/in/alice",
    "123",
    offline(async (request) => {
      calls++;
      assert.equal(request.maxCostUsd, "0.01");
      assert.equal(request.operationId, "bazaar-x402-atlas-183");
      assert.equal(request.accessMethodId, "bazaar-x402-atlas-183-x402");
      assert.equal(new URL(request.url).searchParams.get("username"), "alice");
      return response(200, {
        data: {
          core: { name: "Alice", screen_name: "Alice" },
          profile_bio: {
            description: "founder github.com/alice",
            entities: {
              url: { urls: [{ expanded_url: "https://example.com" }] },
            },
          },
          professional: { category: [{ name: "Tools" }] },
          location: { location: "building, cool stuff" },
          tweet_counts: { tweets: 20 },
          privacy: { protected: false },
          avatar: { image_url: "https://example.com/avatar_normal.jpg" },
        },
      });
    }),
  );
  assert.equal(calls, 1);
  assert.ok(profile);
  assert.equal(profile.name, "Alice");
  assert.equal(profile.handle, "Alice");
  assert.equal(profile.website, "https://example.com");
  assert.equal(profile.category, "Tools");
  assert.equal(profile.github, "https://github.com/alice");
  assert.equal(profile.linkedin, "https://www.linkedin.com/in/alice");
  assert.equal(profile.introUrl, "https://x.com/Alice/status/123");
  assert.equal(profile.avatarUrl, "https://example.com/avatar_400x400.jpg");
  assert.equal(profile.vibe.score, 100);
  assert.equal(profile.city, null);
  assert.equal(profile.country, null);
  assert.equal(profile.location, "building, cool stuff");
});

test("search uses historical sourcing phrase, encodes cursors, and filters malformed hits", async () => {
  const result = await searchIntroPage(
    "a&b",
    offline(async (request) => {
      const url = new URL(request.url);
      assert.equal(url.searchParams.get("phrase"), "I'm a solo founder");
      assert.equal(url.searchParams.get("cursor"), "a&b");
      assert.equal(request.maxCostUsd, "0.01");
      return response(200, {
        cursor: "next",
        tweets: [
          null,
          {},
          {
            author: { screen_name: "alice", name: "Alice" },
            text: "I'm a solo founder building X",
            id_str: "123",
          },
          {
            author: { screen_name: "bob", name: "Bob" },
            text: "intro",
            id_str: "456",
          },
          {
            author: { screen_name: "not/a/handle", name: "Bad" },
            text: "I'm a solo founder building X",
            id_str: "789",
          },
          {
            author: { screen_name: "carol", name: "Carol" },
            text: "I'm a solo founder building X",
            id_str: "not-an-id",
          },
        ],
      });
    }),
  );
  assert.deepEqual(result, {
    cursor: "next",
    hits: [
      {
        handle: "alice",
        name: "Alice",
        text: "I'm a solo founder building X",
        tweetId: "123",
      },
    ],
  });
});

test("pagination keeps walking when a latest page is only retweets", async () => {
  const pages: Array<string | null> = [];
  const hits = await searchIntroPages(
    3,
    offline(async (request) => {
      const url = new URL(request.url);
      const phrase = url.searchParams.get("phrase");
      const cursor = url.searchParams.get("cursor");
      if (phrase !== "I'm a solo founder") {
        return response(200, { tweets: [] });
      }
      pages.push(cursor);
      if (!cursor) {
        return response(200, {
          cursor: "p2",
          tweets: [
            {
              author: { screen_name: "spam", name: "Spam" },
              text: "RT @haukejung: I'm a solo founder",
              id_str: "1",
            },
          ],
        });
      }
      if (cursor === "p2") {
        return response(200, {
          cursor: "p3",
          tweets: [
            {
              author: { screen_name: "alice", name: "Alice" },
              text: "I'm a solo founder building X",
              id_str: "2",
            },
          ],
        });
      }
      return response(200, { tweets: [] });
    }),
  );
  assert.deepEqual(pages, [null, "p2", "p3"]);
  assert.deepEqual(
    hits.map((hit) => hit.handle),
    ["alice"],
  );
});
