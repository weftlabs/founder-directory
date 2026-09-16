import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeDirectoryCursor,
  directoryFiltersFromSearchParams,
  encodeDirectoryCursor,
  emptyDirectoryPage,
} from "../lib/directory-page";

test("directory cursors round-trip a keyset of updated_at and handle", () => {
  const cursor = {
    updatedAt: "2026-09-16T12:00:00.000Z",
    handle: "alice_founder",
  };
  assert.deepEqual(
    decodeDirectoryCursor(encodeDirectoryCursor(cursor)),
    cursor,
  );
});

test("invalid directory cursors fail closed", () => {
  assert.equal(decodeDirectoryCursor(""), null);
  assert.equal(decodeDirectoryCursor("not-a-cursor"), null);
  assert.equal(decodeDirectoryCursor("%%%"), null);
  assert.equal(
    decodeDirectoryCursor(Buffer.from("[]", "utf8").toString("base64url")),
    null,
  );
  assert.equal(
    decodeDirectoryCursor(Buffer.from("null", "utf8").toString("base64url")),
    null,
  );
  assert.equal(
    decodeDirectoryCursor(
      Buffer.from(JSON.stringify({ u: 1, h: "alice" }), "utf8").toString(
        "base64url",
      ),
    ),
    null,
  );
  assert.equal(
    decodeDirectoryCursor(
      Buffer.from(
        JSON.stringify({ u: "not-a-date", h: "alice" }),
        "utf8",
      ).toString("base64url"),
    ),
    null,
  );
  assert.equal(
    decodeDirectoryCursor(
      Buffer.from(
        JSON.stringify({ u: "2026-09-16T12:00:00.000Z" }),
        "utf8",
      ).toString("base64url"),
    ),
    null,
  );
  assert.equal(
    decodeDirectoryCursor(
      Buffer.from(
        JSON.stringify({ u: "2026-09-16T12:00:00.000Z", h: "" }),
        "utf8",
      ).toString("base64url"),
    ),
    null,
  );
  assert.equal(
    decodeDirectoryCursor(
      Buffer.from(
        JSON.stringify({
          u: "2026-09-16T12:00:00.000Z",
          h: "a".repeat(65),
        }),
        "utf8",
      ).toString("base64url"),
    ),
    null,
  );
});

test("empty directory page is a public JSON shape with no rows", () => {
  assert.deepEqual(emptyDirectoryPage(), {
    founders: [],
    total: 0,
    nextCursor: null,
    categories: [],
    countries: [],
    cities: [],
  });
});

test("directory filters come from public search params only", () => {
  const params = new URLSearchParams(
    "q=berlin&category=Infra&country=Germany&city=Berlin&cursor=ignored",
  );
  assert.deepEqual(directoryFiltersFromSearchParams(params), {
    q: "berlin",
    category: "Infra",
    country: "Germany",
    city: "Berlin",
  });
});
