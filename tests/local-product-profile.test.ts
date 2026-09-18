import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalProductProfile } from "../app/local-product-profile";
import { productCard } from "../lib/products";

test("a local portrait is one founder profile with collapsed receipts and no lab controls", () => {
  const html = renderToStaticMarkup(
    createElement(LocalProductProfile, {
      founder: {
        handle: "example",
        name: "Example founder",
        bio: "A saved bio",
        location: null,
        website: null,
        avatarUrl: null,
        dna: null,
        products: [
          productCard({
            name: {
              value: "Example product",
              state: "supported",
              kind: "self_report",
            },
            founders: ["example"],
          }),
        ],
        portrait: {
          archetype: {
            title: "The builder",
            kicker: "Builder energy",
            hook: "A distinctive hook",
            summary: "An editorial summary",
            tags: ["Makes things"],
          },
          story: {
            title: "A connection",
            before: "Design",
            after: "Software",
            connection: "A useful connection",
          },
          roast: {
            title: "A friendly roast",
            lines: [{ text: "A gentle joke", receipt: "A post" }],
          },
          receipts: [
            {
              label: "A post",
              quote: "I built a thing.",
              source: "post",
              url: "https://example.test/posts/1",
            },
            {
              label: "Team",
              quote: "Example is a co-founder.",
              source: "biography",
              url: "https://example.test/team",
            },
          ],
          shareText: "My founder portrait.",
        },
      },
    }),
  );
  for (const text of [
    "The builder",
    "A distinctive hook",
    "A useful connection",
    "A gentle joke",
    "Example product",
    "Why this fits",
    "Saved post",
    "Official bio",
    "My founder portrait.",
  ])
    assert.ok(html.includes(text), text);
  for (const text of [
    "Portrait lab",
    "Choose a founder",
    "Choose a portrait concept",
    "Try DNA portraits",
  ])
    assert.equal(html.includes(text), false, text);
  assert.match(html, /<details class="profile-why"><summary>Why this fits/);
  assert.ok(
    html.indexOf("A distinctive hook") < html.indexOf("Example product"),
  );
});
