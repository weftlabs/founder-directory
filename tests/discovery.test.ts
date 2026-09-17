import assert from "node:assert/strict";
import { test } from "node:test";
import { locateFounder } from "../lib/geography";
import { rankFounders, readIntroMetrics } from "../lib/discovery";

test("city matching requires a country and rejects ambiguous or unknown places", () => {
  assert.deepEqual(
    locateFounder({ city: "Berlin", country: "Germany" }),
    [13.41053, 52.52437],
  );
  assert.equal(locateFounder({ city: "Paris", country: null }), null);
  assert.equal(locateFounder({ city: "Mars", country: "Germany" }), null);
  assert.equal(
    locateFounder({ city: "Springfield", country: "United States" }),
    null,
  );
  assert.ok(locateFounder({ city: "London", country: "UK" }));
});
test("rankings exclude unknown metrics, preserve zero and break ties by handle", () => {
  const rows = [
    { handle: "z", introMetrics: { likes: 10, views: null } },
    { handle: "a", introMetrics: { likes: 10, views: 5 } },
    { handle: "b", introMetrics: { likes: 0, views: 100 } },
    { handle: "missing", introMetrics: null },
  ];
  assert.deepEqual(
    rankFounders(rows, "likes").map((x) => x.handle),
    ["a", "z", "b"],
  );
  assert.deepEqual(
    rankFounders(rows, "views").map((x) => x.handle),
    ["b", "a"],
  );
  assert.equal(rows[0].handle, "z");
});
test("only finite nonnegative integral source counts are accepted", () => {
  const counts = readIntroMetrics(
    { favorite_count: 12, views: { count: "405" } },
    "2026-09-17T00:00:00.000Z",
  );
  assert.deepEqual(counts, {
    likes: 12,
    views: 405,
    observedAt: "2026-09-17T00:00:00.000Z",
  });
  assert.equal(
    readIntroMetrics({ favorite_count: -2, view_count: "no" }),
    null,
  );
  assert.equal(readIntroMetrics({ favorite_count: 1.5 }), null);
});

test("search metrics survive the pending queue round trip", async () => {
  const { parsePendingIntros, serializePendingIntros } =
    await import("../lib/scan");
  const hit = {
    handle: "example",
    name: "Example",
    text: "I'm a founder",
    tweetId: "123",
    introMetrics: { likes: 0, views: 120, observedAt: "2026-09-17T00:00:00Z" },
  };
  assert.deepEqual(parsePendingIntros(serializePendingIntros([hit])), [hit]);
});

test("search adapter captures metrics on the correct source post", async () => {
  const { searchIntroPage } = await import("../lib/x");
  const { offline, response } = await import("./fixtures");
  const result = await searchIntroPage(
    undefined,
    offline(async () =>
      response(200, {
        tweets: [
          {
            id_str: "123",
            text: "I'm a solo founder",
            author: { screen_name: "example", name: "Example" },
            favorite_count: 12,
            views: { count: "305" },
          },
        ],
      }),
    ),
  );
  assert.equal(result.hits[0].tweetId, "123");
  assert.equal(result.hits[0].introMetrics?.likes, 12);
  assert.equal(result.hits[0].introMetrics?.views, 305);
});

test("common city and country aliases resolve", () => {
  assert.ok(locateFounder({ city: "New York", country: "USA" }));
  assert.ok(locateFounder({ city: "Istanbul", country: "Türkiye" }));
});

test("recorded search public_metrics shape preserves likes without inventing views", () => {
  // Synthetic values with the public_metrics shape in saved search responses.
  assert.deepEqual(
    readIntroMetrics(
      {
        public_metrics: {
          retweet_count: 2,
          reply_count: 3,
          like_count: 14,
          quote_count: 1,
          bookmark_count: 0,
        },
      },
      "2026-09-17T00:00:00Z",
    ),
    { likes: 14, views: null, observedAt: "2026-09-17T00:00:00Z" },
  );
});
