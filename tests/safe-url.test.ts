import assert from "node:assert/strict";
import { test } from "node:test";
import { safeHttpUrl } from "../lib/model";

test("public profile links allow only absolute credential-free HTTP(S)", () => {
  for (const url of [
    null,
    "",
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.com",
    "/internal",
    "https://user:pass@example.com",
    "bad url",
  ]) {
    assert.equal(safeHttpUrl(url), null);
  }
  assert.equal(
    safeHttpUrl("https://example.com/profile"),
    "https://example.com/profile",
  );
  assert.equal(safeHttpUrl("http://example.com"), "http://example.com");
});
