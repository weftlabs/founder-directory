import assert from "node:assert/strict";
import { test } from "node:test";
import { isPresenceSessionId } from "../lib/presence";

test("accepts browser session UUIDs and rejects junk", () => {
  assert.equal(
    isPresenceSessionId("550e8400-e29b-41d4-a716-446655440000"),
    true,
  );
  assert.equal(isPresenceSessionId("not-a-uuid"), false);
  assert.equal(isPresenceSessionId(""), false);
  assert.equal(
    isPresenceSessionId("550e8400-e29b-41d4-a716-446655440000'; drop table"),
    false,
  );
});
