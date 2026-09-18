import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalProductFounder } from "../lib/product-snapshot";
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
