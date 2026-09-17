import assert from "node:assert/strict";
import { test } from "node:test";
import { locateFounder } from "../lib/geography";

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
test("common city and country aliases resolve", () => {
  assert.ok(locateFounder({ city: "New York", country: "USA" }));
  assert.ok(locateFounder({ city: "Istanbul", country: "Türkiye" }));
});
