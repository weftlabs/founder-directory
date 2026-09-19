import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFounderDnaProfile } from "../lib/founder-dna";
import { founderDnaFixture } from "./fixtures/founder-dna";
import { loadFounderDnaProfile } from "../lib/founder-dna-data";
test("public DNA projection is bounded, strips private fields and permits no product", () => {
  const profile = parseFounderDnaProfile({
    ...founderDnaFixture(),
    secret: "PRIVATE",
    vectors: [1],
  });
  assert.equal(profile.products.length, 0);
  assert.equal(JSON.stringify(profile).includes("PRIVATE"), false);
  assert.throws(() =>
    parseFounderDnaProfile({ ...profile, connections: Array(4).fill({}) }),
  );
  assert.throws(() =>
    parseFounderDnaProfile({
      ...profile,
      sources: [
        {
          id: "source",
          label: "Source",
          kind: "bio",
          url: "javascript:bad",
          excerpt: "Text",
        },
      ],
    }),
  );
});
test("disabled reader does not access database and enabled missing DB is unavailable", async () => {
  const db = {
    query: async () => {
      throw new Error("must not query");
    },
  };
  assert.deepEqual(await loadFounderDnaProfile("example", {}, db), {
    status: "disabled",
  });
  assert.deepEqual(
    await loadFounderDnaProfile("example", { FOUNDER_DNA_ENABLED: "1" }),
    { status: "unavailable" },
  );
});
