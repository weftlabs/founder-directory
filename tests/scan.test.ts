import assert from "node:assert/strict";
import { test } from "node:test";
import { unknownHits } from "../lib/scan";
import type { TrendHit } from "../lib/x";

function hit(handle: string): TrendHit {
  return {
    handle,
    name: handle,
    text: `I'm a solo founder ${handle}`,
    tweetId: handle,
  };
}

test("imports every unknown intro instead of dropping a quota", () => {
  const hits = [
    hit("alice"),
    hit("bob"),
    hit("carol"),
    hit("dave"),
    hit("erin"),
    hit("frank"),
    hit("gina"),
    hit("hank"),
    hit("iris"),
    hit("ALICE"),
    hit("bob"),
  ];
  const selected = unknownHits(hits, new Set(["bob"]));
  assert.deepEqual(
    selected.map((row) => row.handle),
    ["alice", "carol", "dave", "erin", "frank", "gina", "hank", "iris"],
  );
});
