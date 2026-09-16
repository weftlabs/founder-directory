import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categorize,
  extractGithub,
  extractLinkedin,
  parseHandle,
  scoreVibe,
} from "../lib/model";

const base = { bio: null, website: null, github: null, professional: null };

test("categorization preserves precedence and matches words rather than substrings", () => {
  for (const [input, expected] of [
    [{}, "Unclear"],
    [{ bio: "stealth API", github: "github.com/a" }, "Stealth"],
    [{ bio: "stealth API", website: "https://example.com" }, "Infra"],
    [{ bio: "consumer agent", github: "github.com/a" }, "Infra"],
    [{ bio: "design", github: "github.com/a" }, "Tools"],
    [{ bio: "open-source" }, "Tools"],
    [{ professional: "devtools" }, "Tools"],
    [{ bio: "community founder" }, "Consumer"],
    [{ bio: "shipping" }, "Infra"],
    [{ bio: "application agentic infrastructure" }, "Unclear"],
  ] as const)
    assert.equal(categorize({ ...base, ...input }), expected);
});

test("social URL extraction canonicalizes actual profiles, not lookalike hosts", () => {
  assert.equal(
    extractGithub("building at https://www.github.com/Alice-dev/repo"),
    "https://github.com/Alice-dev",
  );
  assert.equal(extractGithub("(github.com/a)"), "https://github.com/a");
  assert.equal(
    extractLinkedin("me: linkedin.com/in/alice-dev_1/?utm=foo"),
    "https://www.linkedin.com/in/alice-dev_1",
  );
  for (const value of [
    null,
    "",
    "notgithub.com/alice",
    "https://evil.github.com/alice",
    "https://evil.test/github.com/alice",
    `github.com/${"a".repeat(40)}`,
    "github.com/alice_",
  ]) {
    assert.equal(extractGithub(value), null, String(value));
  }
  for (const value of [
    null,
    "",
    "notlinkedin.com/in/alice",
    "https://evil.linkedin.com/in/alice",
    "linkedin.com/company/a",
  ]) {
    assert.equal(extractLinkedin(value), null, String(value));
  }
});

test("vibe weights and thresholds retain sourcing language with neutral labels", () => {
  const input = { ...base, protected: true, tweets: null };
  assert.equal(scoreVibe(input).score, 0);
  assert.equal(scoreVibe(input).label, "Weak founder signal");
  assert.equal(
    scoreVibe({ ...input, bio: "I'm a solo founder" }).label,
    "Builder",
  );
  assert.equal(
    scoreVibe({
      ...input,
      bio: "founder",
      website: "site",
      professional: "tech",
    }).label,
    "Strong founder signal",
  );
  const all = scoreVibe({
    ...input,
    bio: "co-founder",
    website: "site",
    professional: "tech",
    github: "gh",
    protected: false,
    tweets: 20,
  });
  assert.equal(all.score, 100);
  assert.equal(all.signals.length, 6);
  assert.ok(all.signals.every((signal) => signal.hit));
  assert.equal(scoreVibe({ ...input, tweets: 19 }).score, 0);
  assert.equal(scoreVibe({ ...input, tweets: 20 }).score, 10);
});

test("handles preserve case, strip a single @, and reject invalid input", () => {
  assert.equal(parseHandle(" @Alice_1 "), "Alice_1");
  for (const input of [
    "",
    "@@alice",
    "a/b",
    "https://x.com/a",
    "a b",
    "a".repeat(16),
  ]) {
    assert.throws(() => parseHandle(input), TypeError);
  }
});
