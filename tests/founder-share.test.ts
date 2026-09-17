import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clipShareText,
  founderShareData,
  shareImageMetadata,
} from "../lib/founder-share";
import type { Founder } from "../lib/model";

test("social text truncates safely and does not invent missing profiles", () => {
  assert.equal(clipShareText("  hello   world  ", 20), "hello world");
  assert.equal(clipShareText("abcdef", 4), "abc…");
  assert.equal(clipShareText("😀😀😀😀", 3), "Fo…");
  assert.equal(founderShareData(null, null), null);
});

test("social text removes glyphs that would trigger remote font fallback", () => {
  assert.equal(clipShareText("示例 Founder 🚀", 40), "Founder");
  assert.equal(clipShareText("示例", 40), "Founder profile");
});

test("ordinary imported founders get a truthful card without enrichment", () => {
  const founder: Founder = {
    name: "Example Founder",
    handle: "example",
    bio: "Building a product",
    website: null,
    github: null,
    linkedin: null,
    city: null,
    country: null,
    location: null,
    avatarUrl: null,
    category: "Unclear",
    vibe: { score: 0, label: "Unknown", signals: [] },
    introText: null,
    introUrl: null,
    updatedAt: null,
  };
  const card = founderShareData(null, founder);
  assert.equal(card?.headline, founder.bio);
  assert.equal(card?.product, null);
  assert.deepEqual(card?.tags, []);
  assert.equal(
    shareImageMetadata(founder.handle, founder.name)[0].url,
    "/u/example/share-image",
  );
});
