import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoveryPage,
  discoveryQuery,
  type DiscoveryFounder,
} from "../lib/discovery";
import { directoryCard } from "../lib/directory-page";
import type { Founder } from "../lib/model";
const founders: DiscoveryFounder[] = Array.from({ length: 120 }, (_, i) => ({
  handle: `person_${i}`,
  name: `Person ${i}`,
  bio: `Bio ${i}`,
  city: "Berlin",
  country: "Germany",
  category: "Tools",
  avatarUrl: null,
  introUrl: null,
  introMetrics: {
    likes: 120 - i,
    views: i,
    observedAt: "2026-09-17T00:00:00Z",
  },
  coordinates: [13.41, 52.52],
}));
test("public discovery payload contains only one page of identities", () => {
  for (const mode of ["map", "leaderboard"] as const) {
    const result = discoveryPage(founders, discoveryQuery({}), mode);
    assert.equal(result.founders.length, 48);
    assert.equal(result.serverPage.hasMore, true);
    assert.equal(result.serverPage.total, 120);
    assert.equal(JSON.stringify(result).includes("person_48"), false);
    assert.equal(JSON.stringify(result).includes("Bio 119"), false);
    const second = discoveryPage(founders, discoveryQuery({ page: "2" }), mode);
    assert.equal(second.founders[0].handle, "person_48");
  }
});
test("map overview has only anonymous city counts", () => {
  const result = discoveryPage(founders, discoveryQuery({}), "map");
  assert.deepEqual(result.serverPage.places, [
    {
      city: "Berlin",
      country: "Germany",
      coordinates: [13.41, 52.52],
      count: 120,
    },
  ]);
});
test("city aliases share one pin and retain all founders when selected", () => {
  const aliases = [
    {
      ...founders[0],
      city: "NYC",
      country: "USA",
      coordinates: [-74, 40.7] as [number, number],
    },
    {
      ...founders[1],
      city: "New York",
      country: "United States",
      coordinates: [-74, 40.7] as [number, number],
    },
    founders[2],
  ];
  const overview = discoveryPage(aliases, discoveryQuery({}), "map");
  assert.equal(overview.serverPage.places.length, 2);
  assert.equal(overview.serverPage.places[0].count, 2);
  for (const [city, country] of [
    ["NYC", "USA"],
    ["New York", "United States"],
  ]) {
    const selected = discoveryPage(
      aliases,
      discoveryQuery({ city, country }),
      "map",
    );
    assert.equal(selected.founders.length, 2);
    assert.equal(selected.serverPage.places.length, 1);
    assert.equal(selected.serverPage.places[0].count, 2);
  }
});
test("filters and ranking run before pagination with no client-requested size", () => {
  const query = discoveryQuery({
    metric: "views",
    limit: "1000000",
    page: "1",
  });
  const result = discoveryPage(founders, query, "leaderboard");
  assert.equal(result.founders.length, 48);
  assert.equal(result.founders[0].handle, "person_119");
  assert.equal(
    discoveryPage(founders, discoveryQuery({ country: "France" }), "map")
      .founders.length,
    0,
  );
  for (const page of ["-1", "1.5", "NaN", "Infinity"])
    assert.equal(discoveryQuery({ page }).page, 1);
});
test("directory cards strip source content, links and analysis payloads", () => {
  const full = {
    ...founders[0],
    location: "raw location",
    website: "https://example.com",
    github: "https://github.com/example",
    linkedin: null,
    introText: "SOURCE_TEXT_NOT_FOR_INDEX",
    vibe: {
      label: "Builder",
      score: 100,
      signals: [{ id: "private-ish", hit: true, text: "DETAIL_NOT_FOR_INDEX" }],
    },
    updatedAt: null,
  } satisfies Founder;
  const card = directoryCard(full);
  assert.equal(card.vibe.label, "Builder");
  assert.deepEqual(
    Object.keys(card).sort(),
    [
      "handle",
      "name",
      "bio",
      "city",
      "country",
      "avatarUrl",
      "category",
      "vibe",
    ].sort(),
  );
  assert.equal(
    JSON.stringify(card).includes("SOURCE_TEXT_NOT_FOR_INDEX"),
    false,
  );
  assert.equal(JSON.stringify(card).includes("DETAIL_NOT_FOR_INDEX"), false);
});
