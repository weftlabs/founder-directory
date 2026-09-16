import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyBuilder,
  parseBuilderDnaExamples,
  type BuilderEvidence,
} from "../lib/builder-dna";

const evidence = (
  excerpt: string,
  kind: BuilderEvidence["kind"] = "product-site",
): BuilderEvidence => ({
  id: "source",
  title: "Source",
  excerpt,
  kind,
  url: "https://example.com",
  sourceLabel: "Product website",
  observedAt: "2026-09-16T16:09:47Z",
});

test("generic founder language does not imply infrastructure", () => {
  const result = classifyBuilder([
    evidence("I'm a founder building things", "self-reported"),
  ]);
  assert.deepEqual(result.productTags, []);
  assert.deepEqual(result.craft, []);
  assert.equal(result.signature, "Still taking shape");
});

test("classifies the product and audience, not presence of AI or API", () => {
  const result = classifyBuilder([
    evidence(
      "Digital workforce for logistics. AI workers for shippers, carriers and 3PLs.",
    ),
  ]);
  assert.deepEqual(result.productTags, ["AI applications"]);
  assert.deepEqual(result.domains, ["Logistics"]);
  assert.ok(!result.productTags.includes("Infrastructure"));
});

test("healthcare product is not blindly classified as consumer", () => {
  const result = classifyBuilder([
    evidence(
      "Building a medication app for nurses and midwives. Full-Stack dev. Documenting the journey in public",
      "self-reported",
    ),
  ]);
  assert.deepEqual(result.domains, ["Healthcare"]);
  assert.deepEqual(result.craft, ["Engineering"]);
  assert.deepEqual(result.workingStyle, ["Build-in-public"]);
});

test("brand tools keep the customer use case despite API terminology", () => {
  const result = classifyBuilder([
    evidence(
      "Former designer, consultant, strategist. Personal brand agent. API and MCP.",
      "self-reported",
    ),
  ]);
  assert.deepEqual(result.domains, ["Branding & marketing"]);
  assert.ok(result.craft.includes("Product & Design"));
  assert.ok(!result.productTags.includes("Infrastructure"));
});

test("snapshot parser rejects executable URLs and duplicate handles", () => {
  const valid = {
    handle: "example",
    name: "Example",
    initials: "EX",
    location: "Unknown",
    product: "Example app",
    website: "https://example.com",
    oldCategory: "Unclear",
    summary: "Example",
    evidence: [evidence("A product")],
    unknowns: ["Activity not checked"],
    ...classifyBuilder([evidence("A product")]),
  };
  assert.equal(parseBuilderDnaExamples([valid]).length, 1);
  assert.throws(() =>
    parseBuilderDnaExamples([{ ...valid, website: "javascript:alert(1)" }]),
  );
  assert.throws(() =>
    parseBuilderDnaExamples([
      {
        ...valid,
        evidence: [{ ...evidence("A product"), url: "data:text/html,hello" }],
      },
    ]),
  );
  assert.throws(() =>
    parseBuilderDnaExamples([valid, { ...valid, handle: "EXAMPLE" }]),
  );
  assert.throws(() => parseBuilderDnaExamples([{ ...valid, evidence: [] }]));
  for (const observedAt of ["2026-02-30T00:00:00Z", "09/16/2026"]) {
    assert.throws(() =>
      parseBuilderDnaExamples([
        {
          ...valid,
          evidence: [{ ...valid.evidence[0], observedAt }],
        },
      ]),
    );
  }
});
