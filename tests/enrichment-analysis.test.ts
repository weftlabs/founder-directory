import assert from "node:assert/strict";
import { test } from "node:test";
import { stableDigest, type AnalysisInput } from "../lib/enrichment/contracts";
import {
  prepareAnalysis,
  validateAnalysisOutput,
  embeddingIdentity,
  compatibleEmbeddings,
  runAnalysis,
  replayAnalysis,
  generationContent,
  type AnalysisStore,
} from "../lib/enrichment/analysis";
import {
  buildAnalysisInput,
  DEFAULT_STAGES,
  renderAnalysisMessages,
} from "../lib/enrichment/recipes";

const evidence = {
  id: "e1",
  artifactId: "a1",
  contentHash: stableDigest("Builds tools"),
  text: "Builds tools",
  sourceUrl: "https://example.test/post/1",
  extractorVersion: "1",
};

test("description recipes distinguish founder behavior, source attribution and planned product claims", () => {
  for (const purpose of [
    "founder_dna",
    "product_discovery",
    "product_descriptions",
  ] as const) {
    const { recipe } = buildAnalysisInput({
      entityId: "f",
      releaseId: "r",
      generation: 0,
      purpose,
      evidence: [evidence],
      model: { provider: "fixture", model: "fixture", revision: null },
      codeDigest: "test",
    });
    assert.equal(recipe.promptVersion, "evidence-only-v8");
    assert.deepEqual(recipe.parameters, { temperature: 0, max_tokens: 1800 });
    assert.match(recipe.template, /Write values in English/);
    assert.match(recipe.template, /publisher_statement/);
    if (purpose === "founder_dna")
      assert.match(
        recipe.template,
        /Product capabilities are not founder skills or habits/,
      );
    if (purpose === "product_descriptions")
      assert.match(recipe.template, /planned or announced/);
    if (purpose === "product_discovery")
      assert.match(recipe.template, /Never replace a proper product name/);
    if (purpose === "founder_dna") {
      assert.match(recipe.template, /every factual clause/);
      assert.match(recipe.template, /documenting.*public/i);
      assert.match(recipe.template, /CEO.*not.*craft/i);
    }
    if (purpose === "product_descriptions") {
      assert.match(recipe.template, /website exists does not establish.*stage/);
      assert.match(recipe.template, /problem.*synthesis.*inference/);
    }
  }
});

test("reasoning route reserves output room without changing other model recipes", () => {
  const result = buildAnalysisInput({
    entityId: "f",
    releaseId: "r",
    generation: 0,
    purpose: "founder_dna",
    evidence: [evidence],
    codeDigest: "test",
    model: {
      provider: "weft/blockrun",
      model: "deepseek/deepseek-reasoner",
      revision: null,
    },
  });
  assert.deepEqual(result.recipe.parameters, {
    temperature: 0,
    max_tokens: 8192,
  });
});

test("personal DNA excludes explicitly product-site evidence without discarding it from product analysis", () => {
  const sources = [
    {
      ...evidence,
      id: "personal",
      provenance: { sourceKind: "self-reported", observedAt: null },
    },
    {
      ...evidence,
      id: "product",
      provenance: {
        sourceKind: "product-site",
        observedAt: "2025-03-10T00:00:00Z",
      },
    },
    { ...evidence, id: "unclassified" },
  ];
  const base = {
    entityId: "f",
    releaseId: "r",
    generation: 0,
    evidence: sources,
    model: { provider: "fixture", model: "fixture", revision: null },
    codeDigest: "test",
  };
  const dna = buildAnalysisInput({ ...base, purpose: "founder_dna" });
  assert.deepEqual(
    dna.evidence.map((row) => row.id),
    ["personal", "unclassified"],
  );
  assert.deepEqual(dna.requiredEvidenceIds, ["personal", "unclassified"]);
  assert.equal(
    dna.recipe.selectionPolicy,
    "exclude-product-site-for-personal-dna-v1",
  );
  assert.deepEqual(
    buildAnalysisInput({ ...base, purpose: "product_descriptions" }).evidence,
    sources,
  );
  assert.equal(sources.length, 3);
});

test("provider response schemas type every scalar enum and constant explicitly", () => {
  for (const purpose of [
    "founder_dna",
    "product_discovery",
    "product_descriptions",
  ] as const) {
    const schema = buildAnalysisInput({
      entityId: "f",
      releaseId: "r",
      generation: 0,
      purpose,
      evidence: [evidence],
      model: { provider: "fixture", model: "fixture", revision: null },
      codeDigest: "test",
    }).recipe.responseSchema;
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if ("enum" in node || "const" in node)
        assert.equal(
          node.type,
          "string",
          "scalar enum and const nodes declare string type",
        );
      for (const child of Object.values(node)) visit(child);
    }
    visit(schema);
  }
});
test("rendered citation schemas bind outer and product citations without changing release recipes", () => {
  const base = {
    entityId: "f",
    releaseId: "r",
    generation: 0,
    purpose: "product_discovery" as const,
    model: { provider: "fixture", model: "fixture", revision: null },
    codeDigest: "test",
  };
  const value = buildAnalysisInput({ ...base, evidence: [evidence] });
  const empty = buildAnalysisInput({ ...base, evidence: [] });
  assert.equal(stableDigest(value.recipe), stableDigest(empty.recipe));
  const saved = prepareAnalysis(value);
  let count = 0;
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "evidenceIds") {
        assert.deepEqual(child.items, { type: "string", enum: ["e1"] });
        count++;
      } else visit(child);
    }
  }
  visit(saved.request.responseSchema);
  assert.equal(count, 2);
  assert.equal(
    JSON.stringify(value.recipe.responseSchema).includes('"e1"'),
    false,
  );
  assert.deepEqual(
    prepareAnalysis(JSON.parse(JSON.stringify(saved))).request,
    saved.request,
  );
});

const recipe = {
  purpose: "founder_dna",
  schemaVersion: "1",
  parserVersion: "1",
  promptVersion: "1",
  template: "Describe evidence",
  provider: "synthetic",
  model: "fixture",
  modelRevision: "1",
  parameters: { temperature: 0 },
  responseSchema: { type: "object" },
  toolDefinitions: [],
  codeDigest: "code1",
  selectionPolicy: "all-v1",
};
const input: AnalysisInput = {
  entityId: "founder1",
  releaseId: "release1",
  generation: 1,
  recipe,
  evidence: [evidence],
  requiredEvidenceIds: ["e1"],
  upstreamOutputs: [],
  messages: [{ role: "user" as const, content: "Describe: Builds tools" }],
  context: [],
};
input.messages = renderAnalysisMessages(input);

test("canonical hashes ignore key insertion order but preserve ordered input", () => {
  assert.equal(stableDigest({ b: 2, a: 1 }), stableDigest({ a: 1, b: 2 }));
  assert.notEqual(stableDigest([1, 2]), stableDigest([2, 1]));
  assert.throws(() => stableDigest({ missing: undefined }), /JSON/);
});

test("recipe and source input identities are independent of release labels", () => {
  const first = prepareAnalysis(input);
  assert.equal("responseSchema" in first.request, false);
  const next = prepareAnalysis({ ...input, releaseId: "release2" });
  assert.equal(first.recipeDigest, next.recipeDigest);
  assert.equal(first.inputDigest, next.inputDigest);
  const changed = prepareAnalysis({
    ...input,
    recipe: { ...recipe, promptVersion: "2" },
  });
  assert.notEqual(first.recipeDigest, changed.recipeDigest);
  assert.equal(first.inputDigest, changed.inputDigest);
  assert.deepEqual(first.request.messages, input.messages);
  assert.deepEqual(first.manifest.evidence, [evidence]);
  input.messages[0].content = "changed after preparation";
  assert.equal(first.request.messages[0].content, recipe.template);
  input.messages = renderAnalysisMessages(input);
});

test("rederive refuses missing evidence and altered bytes without a source callback", () => {
  assert.throws(
    () => prepareAnalysis({ ...input, requiredEvidenceIds: ["missing"] }),
    /missing_input/,
  );
  assert.throws(
    () =>
      prepareAnalysis({
        ...input,
        evidence: [{ ...evidence, text: "changed" }],
      }),
    /input_hash_mismatch/,
  );
});

test("claims must cite selected evidence and malformed/refused outputs are rejected", () => {
  const valid = {
    schemaVersion: "1",
    claims: [
      {
        field: "description",
        value: "Builds tools",
        kind: "self_report",
        state: "supported",
        evidenceIds: ["e1"],
      },
    ],
  };
  assert.equal(
    validateAnalysisOutput(JSON.stringify(valid), ["e1"], "1").valid,
    true,
  );
  assert.equal(
    validateAnalysisOutput(JSON.stringify(valid), ["unrelated"], "1").valid,
    false,
  );
  assert.equal(validateAnalysisOutput("not JSON", ["e1"], "1").valid, false);
  assert.equal(
    validateAnalysisOutput('{"refusal":"No"}', ["e1"], "1").valid,
    false,
  );
  assert.equal(
    validateAnalysisOutput(
      JSON.stringify({
        ...valid,
        claims: [{ ...valid.claims[0], evidenceIds: [] }],
      }),
      ["e1"],
      "1",
    ).valid,
    false,
  );
});

test("identical embedding text shares identity across entities only in compatible spaces", () => {
  const spec = {
    scope: "public",
    text: "A tool",
    templateVersion: "product-v1",
    model: "test",
    modelVersion: "1",
    dimensions: 3,
    distance: "cosine" as const,
  };
  assert.equal(embeddingIdentity(spec), embeddingIdentity({ ...spec }));
  assert.notEqual(
    embeddingIdentity(spec),
    embeddingIdentity({ ...spec, text: "A tool " }),
  );
  assert.equal(
    compatibleEmbeddings(spec, { ...spec, modelVersion: "2" }),
    false,
  );
  assert.throws(
    () => embeddingIdentity({ ...spec, text: "" }),
    /missing_input/,
  );
});

const replayBaseInput = input;
for (const provenance of [
  undefined,
  { sourceKind: "founder_bio", observedAt: "2026-01-01T00:00:00Z" },
])
  test(`the runner preserves inputs through replay (${provenance ? "with provenance" : "legacy"})`, async () => {
    const input: AnalysisInput = {
      ...replayBaseInput,
      evidence: [{ ...evidence, ...(provenance ? { provenance } : {}) }],
    };
    input.messages = renderAnalysisMessages(input);
    const events: string[] = [];
    const artifacts = new Map<string, Uint8Array>();
    const runs: Parameters<AnalysisStore["saveAnalysis"]>[0][] = [];
    const store: AnalysisStore = {
      async assertAnalysisInputs(value) {
        assert.equal(value.entityId, input.entityId);
        assert.deepEqual(value.evidence, [
          {
            id: evidence.id,
            artifactId: evidence.artifactId,
            contentHash: evidence.contentHash,
            text: evidence.text,
            sourceUrl: evidence.sourceUrl,
            extractorVersion: evidence.extractorVersion,
            ...(provenance ? { provenance } : {}),
          },
        ]);
      },
      async findAnalysis(id) {
        return runs.find((run) => run.id === id) ?? null;
      },
      async putArtifact(value) {
        events.push("manifest");
        const id = `a-${artifacts.size}`;
        artifacts.set(id, value.body);
        return { id };
      },
      async getArtifact(id) {
        const body = artifacts.get(id);
        return body ? { id, body } : null;
      },
      async findSuccessfulAnalysis(key) {
        const run = runs.find(
          (row) =>
            row.status === "succeeded" &&
            row.recipeDigest === key.recipeDigest &&
            row.inputDigest === key.inputDigest,
        );
        return run
          ? {
              id: run.id,
              output: run.output,
              inputArtifactId: run.inputArtifactId,
              releaseId: run.releaseId,
              generation: run.generation,
            }
          : null;
      },
      async saveAnalysis(value) {
        events.push("validated");
        runs.push(value);
        return value.id;
      },
    };
    let raw = "invalid JSON";
    const execute = async ({ requestBytes }: { requestBytes: Uint8Array }) => {
      events.push("dispatch");
      assert.equal(events.at(-2), "manifest");
      assert.deepEqual(
        JSON.parse(Buffer.from(requestBytes).toString()),
        prepareAnalysis(input).request,
      );
      const id = `response-${artifacts.size}`;
      artifacts.set(id, Buffer.from(raw));
      return {
        attemptId: "attempt1",
        rawResponse: raw,
        responseArtifactId: id,
        usage: { tokens: 12 },
        finishReason: "stop",
      };
    };
    assert.equal((await runAnalysis(store, input, execute)).status, "failed");
    assert.equal((await runAnalysis(store, input, execute)).status, "failed");
    assert.equal(events.filter((event) => event === "dispatch").length, 1);
    assert.ok(artifacts.has("response-1"));
    assert.equal(runs[0].output, null);
    raw =
      '{"schemaVersion":"1","claims":[{"field":"description","value":"Tools","kind":"self_report","state":"supported","evidenceIds":["e1"]}]}';
    assert.equal(
      (await runAnalysis(store, input, execute, { rerunId: "explicit-retry" }))
        .status,
      "succeeded",
    );
    assert.equal(
      (
        await runAnalysis(
          store,
          { ...input, releaseId: "next-release" },
          execute,
        )
      ).status,
      "reused",
    );
    assert.equal(events.filter((event) => event === "dispatch").length, 2);
    assert.notEqual(runs[0].id, runs[1].id);
    const savedManifest = runs[1].inputArtifactId;
    assert.deepEqual(
      JSON.parse(Buffer.from(artifacts.get(savedManifest)!).toString())
        .evidence,
      input.evidence,
    );
    assert.equal(
      (await replayAnalysis(store, savedManifest, execute)).status,
      "reused",
    );
    await assert.rejects(
      replayAnalysis(store, "missing", execute),
      /missing_input/,
    );
  });

test("provenance is part of immutable input identity without changing excerpt hashes", () => {
  const first = prepareAnalysis(input);
  const provenance = {
    sourceKind: "founder_bio",
    observedAt: "2026-01-01T00:00:00Z",
  };
  const changed = prepareAnalysis({
    ...input,
    evidence: [{ ...evidence, provenance }],
  });
  assert.notEqual(changed.inputDigest, first.inputDigest);
  assert.equal(changed.evidence[0].contentHash, first.evidence[0].contentHash);
  assert.deepEqual(changed.manifest.evidence[0].provenance, provenance);
  provenance.sourceKind = "mutated";
  assert.equal(
    changed.manifest.evidence[0].provenance?.sourceKind,
    "founder_bio",
  );
});

test("forged evidence and suppressed entities fail before cache access or dispatch", async () => {
  let calls = 0;
  let suppressed = false;
  const unreachable = async (): Promise<never> => {
    calls++;
    throw new Error("untrusted input reached I/O");
  };
  const store: AnalysisStore = {
    async assertAnalysisInputs(value) {
      if (suppressed) throw new Error("entity_suppressed");
      if (value.evidence.some((row) => row.text !== evidence.text))
        throw new Error("evidence_content_mismatch");
    },
    findAnalysis: unreachable,
    findSuccessfulAnalysis: unreachable,
    putArtifact: unreachable,
    getArtifact: unreachable,
    saveAnalysis: unreachable,
  };
  const text = "Forged data with a matching caller-supplied hash";
  await assert.rejects(
    runAnalysis(
      store,
      {
        ...input,
        evidence: [{ ...evidence, text, contentHash: stableDigest(text) }],
        messages: renderAnalysisMessages({
          ...input,
          evidence: [{ ...evidence, text, contentHash: stableDigest(text) }],
        }),
      },
      unreachable,
    ),
    /evidence_content_mismatch/,
  );
  suppressed = true;
  await assert.rejects(
    runAnalysis(store, input, unreachable),
    /entity_suppressed/,
  );
  assert.equal(calls, 0);
});

test("unverified context and upstream output are rejected before any work", async () => {
  let calls = 0;
  const unreachable = async (): Promise<never> => {
    calls++;
    throw new Error("unverified input reached I/O");
  };
  const store: AnalysisStore = {
    assertAnalysisInputs: unreachable,
    findAnalysis: unreachable,
    findSuccessfulAnalysis: unreachable,
    putArtifact: unreachable,
    getArtifact: unreachable,
    saveAnalysis: unreachable,
  };
  await assert.rejects(
    runAnalysis(
      store,
      {
        ...input,
        context: [
          {
            id: "context1",
            text: "unsaved",
            contentHash: stableDigest("unsaved"),
            rank: 0,
          },
        ],
      },
      unreachable,
    ),
    /unverified_context_not_supported/,
  );
  await assert.rejects(
    runAnalysis(
      store,
      {
        ...input,
        upstreamOutputs: [
          {
            id: "output1",
            output: { description: "unsaved" },
            contentHash: stableDigest({ description: "unsaved" }),
          },
        ],
      },
      unreachable,
    ),
    /unverified_context_not_supported/,
  );
  assert.equal(calls, 0);
});

test("default recipes require cited product and DNA fields without numeric ability scores", () => {
  const value = buildAnalysisInput({
    entityId: "founder1",
    releaseId: "release1",
    generation: 1,
    purpose: "founder_dna",
    evidence: [evidence],
    model: { provider: "fixture", model: "fixture", revision: "1" },
    codeDigest: "code1",
  });
  assert.ok(value.messages[0].content.includes("Never score"));
  assert.ok(value.recipe.template.includes("unknown"));
  assert.ok(
    DEFAULT_STAGES.some((stage) => stage.id === "product_descriptions"),
  );
  assert.equal(prepareAnalysis(value).evidence[0].id, "e1");
  assert.equal(
    validateAnalysisOutput(
      '{"schemaVersion":"claims-v1","claims":[{"field":"score","value":99,"kind":"inference","state":"supported","evidenceIds":["e1"]}]}',
      ["e1"],
      "claims-v1",
      value.recipe.claimFields,
    ).valid,
    false,
  );
  const raw =
    '{"choices":[{"message":{"content":"{\\"schemaVersion\\":\\"claims-v1\\"}"}}],"usage":{"tokens":10}}';
  assert.equal(generationContent(raw), '{"schemaVersion":"claims-v1"}');
});
