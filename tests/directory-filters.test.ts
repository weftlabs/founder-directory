import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesSearch,
  readFilters,
  type DirectoryFilters,
} from "../lib/directory-filters";
import type { Founder } from "../lib/model";

const founder = (
  overrides: Partial<Founder> & Pick<Founder, "handle">,
): Founder => ({
  name: "Alex",
  bio: "Building tools",
  website: null,
  github: null,
  linkedin: null,
  city: "Berlin",
  country: "Germany",
  location: "Berlin, Germany",
  avatarUrl: null,
  category: "Tools",
  vibe: { score: 0, label: "Demo", signals: [] },
  introText: null,
  introUrl: null,
  updatedAt: null,
  ...overrides,
});

test("search matches substrings including Uncategorized for Unclear", () => {
  const unclear = founder({ handle: "x", category: "Unclear", bio: "Working" });
  assert.equal(matchesSearch(unclear, "uncategorized"), true);
  assert.equal(matchesSearch(unclear, "Berlin"), true);
  assert.equal(matchesSearch(unclear, "nope"), false);
});

test("city-only URLs infer a country only from a complete founder list", () => {
  const founders = [
    founder({ handle: "a", city: "Berlin", country: "Germany" }),
    founder({ handle: "b", city: "Paris", country: "France" }),
    founder({ handle: "c", city: "Paris", country: "United States" }),
  ];
  assert.equal(readFilters("?city=Berlin", founders).country, "Germany");
  assert.equal(readFilters("?city=Paris", founders).country, "");
  const live: DirectoryFilters = readFilters("?city=Berlin");
  assert.equal(live.country, "");
  assert.equal(live.city, "Berlin");
});
