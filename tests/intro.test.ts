import assert from "node:assert/strict";
import { test } from "node:test";
import { isIntro } from "../lib/x";

test("keeps first-person intro cards", () => {
  assert.equal(isIntro("I'm 33.\nSolo founder from France.\nLooking to connect!"), true);
  assert.equal(isIntro("I’m a solo founder from the UK. Currently working on CodePrepped"), true);
  assert.equal(isIntro("im a solo founder building HopUp"), true);
  assert.equal(isIntro("I am a solo founder from England"), true);
  assert.equal(isIntro("I'm 26  Solo founder from GOA"), true);
});

test("drops retweets and third-person mentions", () => {
  assert.equal(isIntro("RT @haukejung: I'm a solo founder"), false);
  assert.equal(
    isIntro("I know a solo founder building an AI productivity app who’d be a fun fit"),
    false,
  );
  assert.equal(isIntro("Always good meeting another solo founder building and shipping"), false);
  assert.equal(isIntro("CFTC says it will issue crypto rules"), false);
});
