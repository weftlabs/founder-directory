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

test("the runner saves exact input before dispatch, preserves failed response and reuses success", async () => {
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
    (await runAnalysis(store, { ...input, releaseId: "next-release" }, execute))
      .status,
    "reused",
  );
  assert.equal(events.filter((event) => event === "dispatch").length, 2);
  assert.notEqual(runs[0].id, runs[1].id);
  const savedManifest = runs[1].inputArtifactId;
  assert.equal(
    (await replayAnalysis(store, savedManifest, execute)).status,
    "reused",
  );
  await assert.rejects(
    replayAnalysis(store, "missing", execute),
    /missing_input/,
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
