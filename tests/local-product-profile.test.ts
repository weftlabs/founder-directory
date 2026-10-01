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
    "What they are building",
    "Source coverage",
    "Indexing post not saved",
    "Founding role not established",
    "Price not stated",
    "not a skill score",
    "Why this fits",
    "Saved post",
    "Official bio",
    "A saved bio",
    "My founder portrait.",
    "profile-initials",
  ])
    assert.ok(html.includes(text), text);
  for (const text of [
    "Portrait lab",
    "Choose a founder",
    "Choose a portrait concept",
    "Try DNA portraits",
    "The connection",
    "product-image",
  ])
    assert.equal(html.includes(text), false, text);
  assert.match(html, /<details class="profile-why"><summary>Why this fits/);
  assert.ok(
    html.indexOf("A distinctive hook") < html.indexOf("Example product"),
  );
  assert.ok(html.indexOf("Example product") < html.indexOf("A gentle joke"));
  assert.match(
    html,
    /<li data-known="false"><span>Role<\/span><strong>Gap<\/strong><\/li>/,
  );
  assert.match(
    html,
    /<li data-known="false"><span>Indexing post<\/span><strong>Gap<\/strong><\/li>/,
  );
  assert.ok(html.indexOf("A saved bio") < html.indexOf("Why this fits"));
  assert.ok(
    html.indexOf("Why this fits") < html.indexOf("A useful connection"),
  );
});

test("saved founder without checked portrait gets an honest card, not invented prose", () => {
  const html = renderToStaticMarkup(
    createElement(LocalProductProfile, {
      founder: {
        handle: "saved",
        name: "Saved founder",
        bio: "Saved bio",
        location: null,
        website: null,
        avatarUrl: null,
        dna: null,
        portrait: null,
        products: [
          productCard({
            name: {
              value: "Saved app",
              state: "supported",
              kind: "self_report",
            },
            founders: ["saved"],
          }),
        ],
      },
    }),
  );
  for (const text of [
    "Local preview",
    "Saved founder",
    "Saved app",
    "Portrait pending",
    "Roast pending source review",
    "Indexing post not saved",
    "Founding role not established",
    "Price not stated",
  ])
    assert.ok(html.includes(text), text);
  assert.equal(html.includes("Share this card"), false);
  assert.equal(
    html.includes("The friendly roast · Editorial interpretation"),
    false,
  );
});

test("card shows supported saved product fields but keeps unsaved fields as gaps", () => {
  const html = renderToStaticMarkup(
    createElement(LocalProductProfile, {
      founder: {
        handle: "fixture",
        name: "Fixture founder",
        bio: "Saved bio text",
        location: null,
        website: null,
        avatarUrl: null,
        dna: null,
        products: [
          productCard({
            name: {
              value: "Care tool",
              state: "supported",
              kind: "self_report",
            },
            description: {
              value: "Offline reference",
              state: "supported",
              kind: "publisher_statement",
            },
            audience: {
              value: "Clinicians",
              state: "supported",
              kind: "publisher_statement",
            },
            stage: {
              value: "Beta",
              state: "supported",
              kind: "publisher_statement",
            },
            founders: ["fixture"],
          }),
        ],
        portrait: {
          archetype: {
            title: "The maker",
            kicker: "Maker",
            hook: "A hook",
            summary: "A summary",
            tags: ["Building"],
          },
          story: {
            title: "Story",
            before: "Before",
            after: "After",
            connection: "Connection",
          },
          roast: {
            title: "A roast",
            lines: [{ text: "A joke", receipt: "Bio" }],
          },
          receipts: [
            {
              label: "Bio",
              quote: "Saved bio text",
              source: "bio",
              url: "https://example.test/bio",
            },
          ],
          shareText: "Share text",
        },
      },
    }),
  );
  for (const value of [
    "Care tool",
    "Offline reference",
    "Clinicians",
    "Stage · ",
    "Beta",
    "Saved bio text",
    "Price not stated",
  ])
    assert.ok(html.includes(value), value);
  for (const label of ["Bio", "Product", "Audience", "Stage"])
    assert.match(
      html,
      new RegExp(
        `<li data-known="true"><span>${label}</span><strong>Saved</strong></li>`,
      ),
    );
  for (const label of ["Role", "Indexing post"])
    assert.match(
      html,
      new RegExp(
        `<li data-known="false"><span>${label}</span><strong>Gap</strong></li>`,
      ),
    );
  assert.equal(html.includes("% model confidence"), false);
  assert.equal(html.includes("Launch Oct"), false);
});
