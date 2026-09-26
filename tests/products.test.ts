import assert from "node:assert/strict";
import { test } from "node:test";
import {
  productCard,
  productQuery,
  productPage,
  productCategory,
  type ProductInput,
} from "../lib/products";
const supported = (value: string) => ({
  value,
  state: "supported",
  kind: "self_report",
});
const input = (name = "Example"): ProductInput => ({
  name: supported(name),
  description: supported("A saved description"),
  domain: supported("Healthcare"),
  productType: supported("application"),
  audience: supported("Doctors"),
  businessModel: { value: null, state: "unknown", kind: "inference" },
  stage: { value: "Beta", state: "supported", kind: "inference" },
  website: "https://example.test",
  founders: ["example"],
});
test("display retains uncertainty, sanitizes links and classifies supported business domains", () => {
  const card = productCard(input());
  assert.equal(card.category, "health");
  assert.equal(card.businessModel.value, null);
  assert.equal(card.stage.kind, "inference");
  assert.equal(
    productCard({
      ...input(),
      website: "javascript:alert(1)",
      founders: ["../secret"],
    }).website,
    null,
  );
  assert.deepEqual(
    productCard({ ...input(), founders: ["../secret"] }).founders,
    [],
  );
  assert.equal(
    productCategory({
      ...input(),
      domain: { value: "Healthcare", state: "unknown", kind: "inference" },
    }),
    "uncategorized",
  );
  assert.equal(
    productCard({
      ...input(),
      description: {
        value: "Should not appear",
        state: "conflict",
        kind: "inference",
      },
    }).description.value,
    null,
  );
});
test("literal search, combined category, stable counts and bounded pagination", () => {
  const cards = Array.from({ length: 25 }, (_, i) =>
    productCard(input(`Example ${String(i).padStart(2, "0")}`)),
  );
  cards[0] = productCard(input("100%_literal"));
  assert.equal(productPage(cards, productQuery({ q: "%_" })).total, 1);
  assert.equal(
    productPage(cards, productQuery({ q: "doctors", category: "health" }))
      .total,
    25,
  );
  assert.equal(
    productPage(cards, productQuery({ q: "example", category: "marketing" }))
      .total,
    0,
  );
  const page = productPage(cards, productQuery({ page: "2" }));
  assert.equal(page.products.length, 12);
  assert.equal(page.total, 25);
  assert.equal(productPage(cards, productQuery({ page: "999999" })).page, 3);
  assert.equal(productQuery({ page: "-2", category: "bad" }).page, 1);
});
