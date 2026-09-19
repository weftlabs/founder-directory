import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { founderDnaFixture } from "./fixtures/founder-dna";
import {
  founderShareMetadata,
  founderShareImageUrl,
  founderShareText,
  clipShareText,
} from "../lib/founder-share";
import { FounderDnaProfileView } from "../app/founder-dna-profile";
import { respondFounderShareImage } from "../lib/founder-share-image";

test("personal metadata has canonical URLs and a revision-specific large image", () => {
  const p = founderDnaFixture();
  const m = founderShareMetadata(p);
  assert.equal(
    m.alternates?.canonical,
    "https://foundersdirectory.app/u/example",
  );
  assert.equal(
    m.twitter && "card" in m.twitter ? m.twitter.card : null,
    "summary_large_image",
  );
  assert.ok(JSON.stringify(m).includes(founderShareImageUrl(p)));
  assert.ok(
    founderShareText(p).endsWith("https://foundersdirectory.app/u/example"),
  );
});

test("actual profile shows roast before connections and works without products or avatar", () => {
  const html = renderToStaticMarkup(
    createElement(FounderDnaProfileView, {
      profile: founderDnaFixture(),
      connections: createElement("section", null, "Explore connections"),
    }),
  );
  assert.ok(
    html.indexOf("The meeting invite") < html.indexOf("Explore connections"),
  );
  assert.match(html, /Why this fits/);
  assert.match(html, /Designer building scheduling tools/);
  assert.equal(html.includes("Portrait lab"), false);
  assert.equal(html.includes("Local preview"), false);
  assert.equal(html.includes("No products"), false);
});

test("image route fails closed and never emits a cached hidden or stale profile", async () => {
  for (const status of [
    "hidden",
    "disabled",
    "not_found",
    "unavailable",
  ] as const) {
    const response = await respondFounderShareImage(
      new Request("http://localhost/u/example/share-image"),
      { status },
    );
    assert.equal(response.status, status === "unavailable" ? 503 : 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const response = await respondFounderShareImage(
    new Request("http://localhost/u/example/share-image?revision=old"),
    { status: "ready", profile: founderDnaFixture() },
  );
  assert.equal(response.status, 404);
});

test("two personal cards render distinct real PNGs offline, including long and missing fields", async () => {
  const a = founderDnaFixture();
  const b = founderDnaFixture();
  b.name = "創業者 🧑‍💻 " + "Long name ".repeat(15);
  b.handle = "other";
  b.portrait.roast.lines[0].text = "A distinct roast ".repeat(24);
  const buffers: Buffer[] = [];
  for (const p of [a, b]) {
    const response = await respondFounderShareImage(
      new Request("http://localhost/u/example/share-image"),
      { status: "ready", profile: p },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(
      bytes.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
    buffers.push(bytes);
  }
  assert.equal(buffers[0].equals(buffers[1]), false);
  assert.ok(clipShareText("🧑‍💻", 20, "@example").includes("@example"));
});
