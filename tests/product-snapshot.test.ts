import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLocalProductFounder,
  loadLocalPortraitFounders,
} from "../lib/product-snapshot";
import { productCard } from "../lib/products";
test("local founder pages use only sanitized linked snapshot profiles and fail closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "founder-preview-"));
  const file = join(dir, "snapshot.json");
  try {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        products: [{ founders: ["Example"], imageUrl: "javascript:alert(1)" }],
        profiles: [
          {
            handle: "Example",
            name: "Saved founder",
            bio: "Saved bio",
            website: "javascript:alert(1)",
            private: "SECRET",
          },
          { handle: "unlinked", name: "Hidden" },
        ],
      }),
    );
    const env = {
      PRODUCTS_LOCAL_SNAPSHOT: file,
      NODE_ENV: "development",
      DATABASE_URL: "must-not-connect",
    };
    const founder = await loadLocalProductFounder("EXAMPLE", env);
    assert.equal(founder?.name, "Saved founder");
    assert.equal(founder?.website, null);
    assert.equal(founder?.products[0].imageUrl, null);
    assert.equal(JSON.stringify(founder).includes("SECRET"), false);
    for (const handle of ["unlinked", "missing", "../secret"])
      assert.equal(await loadLocalProductFounder(handle, env), null);
    for (const extra of [
      { NODE_ENV: "production" },
      { VERCEL: "1" },
      { PRODUCTS_LOCAL_SNAPSHOT: join(dir, "missing") },
    ])
      assert.equal(
        await loadLocalProductFounder("Example", { ...env, ...extra }),
        null,
      );
    await writeFile(file, "{}");
    assert.equal(await loadLocalProductFounder("Example", env), null);
  } finally {
    await rm(dir, { recursive: true });
  }
});
test("product images reject unsafe schemes and credentials", () => {
  for (const imageUrl of [
    "javascript:alert(1)",
    "data:image/png;base64,x",
    "https://user:secret@example.test/image.png",
  ])
    assert.equal(productCard({ imageUrl }).imageUrl, null);
  assert.equal(
    productCard({ imageUrl: "https://example.test/logo.png" }).imageUrl,
    "https://example.test/logo.png",
  );
});

test("local DNA keeps evidence-backed facts and unknown categories, without evaluation data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "founder-dna-preview-"));
  const file = join(dir, "snapshot.json");
  const dna = {
    model: "jev-1.13.0",
    completedAt: "2026-01-01T12:00:00Z",
    facets: [
      { key: "venture_domain", value: "unknown", confidence: 0.89 },
      { key: "craft", value: "technical", confidence: 0.9 },
      { key: "building_style", value: "unknown", confidence: 0.8 },
      { key: "founding_role", value: "cofounder", confidence: 1 },
    ],
    sources: [
      {
        id: "bio",
        url: "https://example.test/bio",
        text: "Software engineer and co-founder.",
      },
    ],
    facts: [
      { text: "Software engineer.", state: "supported", sourceIds: ["bio"] },
      { text: "Unsupported trap", state: "unsupported", sourceIds: ["bio"] },
      { text: "Contradicted trap", state: "contradicted", sourceIds: ["bio"] },
      { text: "No provenance", state: "supported", sourceIds: ["missing"] },
    ],
    expectedFacets: { venture_domain: "marketing" },
    responseText: "PRIVATE RAW RESPONSE",
  };
  const save = (value: unknown) =>
    writeFile(
      file,
      JSON.stringify({
        version: 1,
        products: [{ founders: ["example"] }],
        profiles: [{ handle: "example", dna: value }],
      }),
    );
  const env = { NODE_ENV: "development", PRODUCTS_LOCAL_SNAPSHOT: file };
  try {
    await save(dna);
    const founder = await loadLocalProductFounder("example", env);
    assert.equal(founder?.dna?.facets[0].value, "unknown");
    assert.deepEqual(founder?.dna?.facts, [
      { text: "Software engineer.", state: "supported", sourceIds: ["bio"] },
    ]);
    assert.equal(
      JSON.stringify(founder).includes("PRIVATE RAW RESPONSE"),
      false,
    );
    assert.equal(JSON.stringify(founder).includes("marketing"), false);
    for (const invalid of [
      { ...dna, facets: [...dna.facets.slice(1), dna.facets[1]] },
      { ...dna, facets: dna.facets.map((f) => ({ ...f, confidence: 2 })) },
      { ...dna, facets: dna.facets.map((f) => ({ ...f, value: "invented" })) },
      {
        ...dna,
        sources: [{ id: "bio", url: "javascript:alert(1)", text: "Unsafe" }],
      },
    ]) {
      await save(invalid);
      assert.equal((await loadLocalProductFounder("example", env))?.dna, null);
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("local portraits reject unsafe or ungrounded editorial projections and stay development-only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "founder-portrait-"));
  const file = join(dir, "snapshot.json");
  const portrait = {
    archetype: {
      title: "The builder",
      kicker: "A saved-data portrait",
      hook: "Build, learn, repeat.",
      summary: "An editorial read of the evidence.",
      tags: ["Builds software"],
    },
    roast: {
      title: "A gentle roast",
      lines: [{ text: "Even the side quest has a roadmap.", receipt: "Bio" }],
    },
    story: {
      title: "The plot twist",
      before: "Former designer",
      after: "Building software",
      connection: "A new medium for the same creative work.",
    },
    receipts: [
      {
        label: "Bio",
        quote: "Former designer, now building software.",
        source: "bio",
        url: "https://example.test/bio",
      },
    ],
    shareText: "My founder DNA: The builder.",
    rawResponse: "PRIVATE PROVIDER DATA",
  };
  const save = (value: unknown) =>
    writeFile(
      file,
      JSON.stringify({
        version: 1,
        products: [{ founders: ["example"] }],
        profiles: [{ handle: "example", portrait: value }],
      }),
    );
  const env = { NODE_ENV: "development", PRODUCTS_LOCAL_SNAPSHOT: file };
  try {
    await save(portrait);
    const founder = await loadLocalProductFounder("example", env);
    assert.equal(founder?.portrait?.archetype.title, "The builder");
    assert.equal((await loadLocalPortraitFounders(env)).length, 1);
    assert.equal(
      JSON.stringify(founder).includes("PRIVATE PROVIDER DATA"),
      false,
    );
    await save({
      ...portrait,
      receipts: [
        {
          ...portrait.receipts[0],
          source: "post",
          url: "https://example.test/posts/1",
        },
      ],
    });
    assert.equal(
      (await loadLocalProductFounder("example", env))?.portrait?.receipts[0]
        .source,
      "post",
    );
    await save({
      ...portrait,
      receipts: [
        {
          ...portrait.receipts[0],
          source: "biography",
          url: "https://example.test/team",
        },
      ],
    });
    assert.equal(
      (await loadLocalProductFounder("example", env))?.portrait?.receipts[0]
        .source,
      "biography",
    );
    for (const value of [
      {
        ...portrait,
        receipts: [{ ...portrait.receipts[0], url: "javascript:alert(1)" }],
      },
      {
        ...portrait,
        roast: {
          ...portrait.roast,
          lines: [{ text: "Unfounded", receipt: "missing" }],
        },
      },
      {
        ...portrait,
        archetype: { ...portrait.archetype, title: "x".repeat(121) },
      },
      { ...portrait, receipts: [portrait.receipts[0], portrait.receipts[0]] },
      { ...portrait, receipts: [{ ...portrait.receipts[0], source: ["bio"] }] },
    ]) {
      await save(value);
      assert.equal(
        (await loadLocalProductFounder("example", env))?.portrait,
        null,
      );
    }
    await save(portrait);
    assert.deepEqual(
      await loadLocalPortraitFounders({ ...env, NODE_ENV: "production" }),
      [],
    );
    assert.deepEqual(
      await loadLocalPortraitFounders({ ...env, VERCEL: "1" }),
      [],
    );
    assert.equal(
      await loadLocalProductFounder("example", {
        ...env,
        NODE_ENV: "production",
      }),
      null,
    );
    assert.equal(
      await loadLocalProductFounder("example", { ...env, VERCEL: "1" }),
      null,
    );
  } finally {
    await rm(dir, { recursive: true });
  }
});
