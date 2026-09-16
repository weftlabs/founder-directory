// Layer: orchestration/domain. Owns replay preparation and validation, not paid dispatch.
import {
  canonicalJson,
  stableDigest,
  stableUuid,
  type AnalysisInput,
  type AnalysisRecipe,
  type AnalysisValidation,
  type EmbeddingInput,
  type JsonValue,
  type PreparedAnalysis,
  type RenderedAnalysisRequest,
} from "./contracts";
import { renderAnalysisMessages } from "./recipes";

/** Inputs are already saved, permitted evidence. There is no source-network fallback. */
export function prepareAnalysis(input: AnalysisInput): PreparedAnalysis {
  const copy: AnalysisInput = JSON.parse(canonicalJson(input));
  const ids = new Set(copy.evidence.map((evidence) => evidence.id));
  if (
    !copy.entityId ||
    !copy.releaseId ||
    !Number.isSafeInteger(copy.generation) ||
    copy.generation < 0
  )
    throw new Error("invalid_analysis_identity");
  if (ids.size !== copy.evidence.length) throw new Error("duplicate_evidence");
  if (
    !copy.evidence.length ||
    copy.requiredEvidenceIds.some((id) => !ids.has(id))
  )
    throw new Error("missing_input");
  for (const evidence of copy.evidence) {
    if (
      !evidence.artifactId ||
      stableDigest(evidence.text) !== evidence.contentHash
    )
      throw new Error("input_hash_mismatch");
  }
  for (const context of copy.context) {
    if (
      stableDigest(context.text) !== context.contentHash ||
      !Number.isSafeInteger(context.rank) ||
      context.rank < 0
    )
      throw new Error("input_hash_mismatch");
  }
  for (const upstream of copy.upstreamOutputs) {
    if (stableDigest(upstream.output) !== upstream.contentHash)
      throw new Error("input_hash_mismatch");
  }
  if (
    !copy.messages.length ||
    !copy.recipe.template ||
    !copy.recipe.schemaVersion ||
    !copy.recipe.parserVersion ||
    !copy.recipe.provider ||
    !copy.recipe.model ||
    !copy.recipe.promptVersion ||
    !copy.recipe.codeDigest ||
    !copy.recipe.selectionPolicy
  )
    throw new Error("incomplete_recipe");
  const manifest = {
    evidence: copy.evidence,
    upstreamOutputs: copy.upstreamOutputs,
    context: copy.context,
  };
  const request = {
    recipe: copy.recipe,
    messages: copy.messages,
    context: copy.context,
    evidence: copy.evidence,
  };
  // Rendered messages are part of recipe identity so a changed rendering cannot hit an old cache.
  const recipeDigest = stableDigest({
    recipe: copy.recipe,
    messages: copy.messages,
  });
  return {
    ...copy,
    inputDigest: stableDigest(manifest),
    recipeDigest,
    manifest,
    request,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Supported claims must cite selected evidence. Schema approval is a separate release gate. */
export function validateAnalysisOutput(
  raw: string,
  evidenceIds: readonly string[],
  schemaVersion: string,
  claimFields?: AnalysisRecipe["claimFields"],
): AnalysisValidation {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { valid: false, errors: ["invalid_json"], output: null };
  }
  const errors: string[] = [];
  if (
    !object(value) ||
    value.schemaVersion !== schemaVersion ||
    !Array.isArray(value.claims)
  )
    return { valid: false, errors: ["invalid_envelope"], output: null };
  const allowed = new Set(evidenceIds);
  const fields = new Set<string>();
  for (const claim of value.claims) {
    if (
      !object(claim) ||
      typeof claim.field !== "string" ||
      !claim.field.trim() ||
      !("value" in claim) ||
      !["self_report", "publisher_statement", "inference"].includes(
        String(claim.kind),
      ) ||
      !["supported", "unknown", "conflict", "stale", "absent"].includes(
        String(claim.state),
      ) ||
      !Array.isArray(claim.evidenceIds)
    ) {
      errors.push("invalid_claim");
      continue;
    }
    if (fields.has(claim.field)) errors.push("duplicate_claim_field");
    fields.add(claim.field);
    if (
      Object.keys(claim).some(
        (key) =>
          !["field", "value", "kind", "state", "evidenceIds"].includes(key),
      )
    )
      errors.push("unknown_claim_key");
    if (claimFields) {
      const expected = claimFields.find((field) => field.name === claim.field);
      if (!expected) errors.push("unknown_claim_field");
      else if (expected.type === "product_array" && claim.value !== null) {
        if (
          !Array.isArray(claim.value) ||
          claim.value.length > 8 ||
          (claim.state === "supported" && !claim.value.length)
        )
          errors.push("invalid_products");
        else {
          const productNames = new Set<string>();
          for (const product of claim.value) {
            if (
              !object(product) ||
              typeof product.name !== "string" ||
              !product.name.trim() ||
              product.name.length > 200 ||
              !Array.isArray(product.evidenceIds) ||
              !product.evidenceIds.length ||
              product.evidenceIds.some(
                (id) =>
                  typeof id !== "string" ||
                  !allowed.has(id) ||
                  !(claim.evidenceIds as unknown[]).includes(id),
              ) ||
              (product.website !== null &&
                (typeof product.website !== "string" ||
                  !/^https?:\/\//.test(product.website))) ||
              Object.keys(product).some(
                (key) => !["name", "website", "evidenceIds"].includes(key),
              )
            )
              errors.push("invalid_product_claim");
            else if (productNames.has(product.name.trim().toLowerCase()))
              errors.push("duplicate_product_claim");
            else productNames.add(product.name.trim().toLowerCase());
          }
        }
      } else if (
        claim.value !== null &&
        (expected.type === "string"
          ? typeof claim.value !== "string"
          : !Array.isArray(claim.value) ||
            claim.value.some((item) => typeof item !== "string"))
      )
        errors.push("invalid_claim_value");
    }
    if (
      claim.evidenceIds.some((id) => typeof id !== "string" || !allowed.has(id))
    )
      errors.push("unrelated_evidence");
    if (claim.state !== "unknown" && claim.evidenceIds.length === 0)
      errors.push("missing_claim_evidence");
    if (claim.state === "unknown" && claim.value !== null)
      errors.push("unknown_claim_has_value");
    if (
      claim.state === "supported" &&
      (claim.value === null || claim.value === "")
    )
      errors.push("supported_claim_missing_value");
  }
  if (!value.claims.length) errors.push("empty_claims");
  if (claimFields?.some((field) => !fields.has(field.name)))
    errors.push("missing_required_claim");
  if (
    Object.keys(value).some((key) => !["schemaVersion", "claims"].includes(key))
  )
    errors.push("unknown_envelope_key");
  return {
    valid: !errors.length,
    errors,
    output: errors.length ? null : (value as JsonValue),
  };
}

export function embeddingIdentity(input: EmbeddingInput): string {
  if (!input.text.trim()) throw new Error("missing_input");
  if (
    !Number.isSafeInteger(input.dimensions) ||
    input.dimensions < 1 ||
    !input.model ||
    !input.modelVersion ||
    !input.templateVersion ||
    !input.scope
  )
    throw new Error("invalid_embedding_space");
  return stableDigest(input);
}

export function compatibleEmbeddings(
  left: EmbeddingInput,
  right: EmbeddingInput,
): boolean {
  return (
    left.scope === right.scope &&
    left.templateVersion === right.templateVersion &&
    left.model === right.model &&
    left.modelVersion === right.modelVersion &&
    left.dimensions === right.dimensions &&
    left.distance === right.distance
  );
}

export interface AnalysisStore {
  assertAnalysisInputs(input: {
    entityId: string;
    purpose: string;
    recipeDigest: string;
    subjectName?: string;
    releaseId: string;
    generation: number;
    evidence: {
      id: string;
      artifactId: string;
      contentHash: string;
      text: string;
      sourceUrl: string | null;
      extractorVersion: string;
    }[];
  }): Promise<void>;
  findAnalysis(id: string): Promise<{
    id: string;
    output: unknown;
    inputArtifactId: string;
    releaseId: string;
    generation: number;
    status: "succeeded" | "failed" | "missing_input";
    validationReport: unknown;
  } | null>;
  putArtifact(input: {
    kind: "manifest";
    body: Uint8Array;
    contentType: string;
    redactionVersion: string;
    runId: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  getArtifact(id: string): Promise<{ id: string; body: Uint8Array } | null>;
  findSuccessfulAnalysis(key: {
    entityId: string;
    purpose: string;
    inputDigest: string;
    recipeDigest: string;
  }): Promise<{
    id: string;
    output: unknown;
    inputArtifactId: string;
    releaseId: string;
    generation: number;
  } | null>;
  saveAnalysis(input: {
    id: string;
    entityId: string;
    releaseId: string;
    generation: number;
    purpose: string;
    inputArtifactId: string;
    inputDigest: string;
    recipeDigest: string;
    evidenceIds: string[];
    output: unknown;
    validationReport: unknown;
    status: "succeeded" | "failed" | "missing_input";
  }): Promise<string>;
}

export interface AccountedGeneration {
  attemptId: string;
  rawResponse: string;
  responseArtifactId: string;
  usage: JsonValue;
  finishReason: string | null;
}

/** This callback must reserve and persist dispatch before I/O and archive every exchange.
 * It owns payment uncertainty and deduplicates runId. Never inject a bare model client.
 */
export type ExecuteGeneration = (input: {
  runId: string;
  request: RenderedAnalysisRequest;
  requestBytes: Uint8Array;
}) => Promise<AccountedGeneration>;

/** Reads observable chat content while the complete provider envelope remains archived. */
export function generationContent(raw: string): string {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (object(value) && Array.isArray(value.choices)) {
    const first = value.choices[0];
    if (
      object(first) &&
      object(first.message) &&
      !first.message.refusal &&
      typeof first.message.content === "string"
    )
      return first.message.content;
  }
  return raw;
}

/** At-least-once: stable run identity delegates uncertain/repeat dispatch protection to the ledger. */
export async function runAnalysis(
  store: AnalysisStore,
  input: AnalysisInput,
  execute: ExecuteGeneration,
  options: { rerunId?: string } = {},
) {
  const prepared = prepareAnalysis(input);
  if (
    stableDigest(prepared.messages) !==
    stableDigest(renderAnalysisMessages(prepared))
  )
    throw new Error("untrusted_message_rendering");
  if (prepared.context.length || prepared.upstreamOutputs.length)
    throw new Error("unverified_context_not_supported");
  await store.assertAnalysisInputs({
    entityId: prepared.entityId,
    purpose: prepared.recipe.purpose,
    recipeDigest: stableDigest(prepared.recipe),
    ...(prepared.subjectName ? { subjectName: prepared.subjectName } : {}),
    releaseId: prepared.releaseId,
    generation: prepared.generation,
    evidence: prepared.evidence.map(
      ({ id, artifactId, contentHash, text, sourceUrl, extractorVersion }) => ({
        id,
        artifactId,
        contentHash,
        text,
        sourceUrl,
        extractorVersion,
      }),
    ),
  });
  const key = {
    entityId: input.entityId,
    purpose: input.recipe.purpose,
    inputDigest: prepared.inputDigest,
    recipeDigest: prepared.recipeDigest,
  };
  const runId = stableUuid({
    ...key,
    releaseId: input.releaseId,
    generation: input.generation,
    rerunId: options.rerunId ?? null,
  });
  if (!options.rerunId) {
    const previous = await store.findSuccessfulAnalysis(key);
    if (previous) {
      const reusedRunId =
        previous.releaseId === input.releaseId &&
        previous.generation === input.generation
          ? previous.id
          : stableUuid({
              reuseOf: previous.id,
              releaseId: input.releaseId,
              generation: input.generation,
            });
      if (previous.id !== reusedRunId)
        await store.saveAnalysis({
          id: reusedRunId,
          ...key,
          releaseId: input.releaseId,
          generation: input.generation,
          inputArtifactId: previous.inputArtifactId,
          evidenceIds: input.evidence.map((item) => item.id),
          output: previous.output,
          validationReport: { reusedFromRunId: previous.id },
          status: "succeeded",
        });
      return {
        status: "reused" as const,
        runId: reusedRunId,
        output: previous.output,
      };
    }
  }
  const existing = await store.findAnalysis(runId);
  if (existing)
    return { status: existing.status, runId, output: existing.output };
  const manifest = await store.putArtifact({
    kind: "manifest",
    body: Buffer.from(canonicalJson(prepared)),
    contentType: "application/json",
    redactionVersion: "non-secret-input-v1",
    runId,
    metadata: {
      inputDigest: prepared.inputDigest,
      recipeDigest: prepared.recipeDigest,
    },
  });
  const response = await execute({
    runId,
    request: prepared.request,
    requestBytes: Buffer.from(canonicalJson(prepared.request)),
  });
  if (!response.attemptId || !response.responseArtifactId)
    throw new Error("generation_not_archived");
  const captured = await store.getArtifact(response.responseArtifactId);
  if (
    !captured ||
    Buffer.from(captured.body).toString("utf8") !== response.rawResponse
  )
    throw new Error("generation_capture_mismatch");
  const validation = validateAnalysisOutput(
    generationContent(response.rawResponse),
    input.evidence.map((item) => item.id),
    input.recipe.schemaVersion,
    input.recipe.claimFields,
  );
  if (
    response.finishReason &&
    ["length", "content_filter", "error", "tool_calls"].includes(
      response.finishReason,
    )
  ) {
    validation.valid = false;
    validation.output = null;
    validation.errors.push(`incomplete_generation:${response.finishReason}`);
  }
  const status = validation.valid ? "succeeded" : "failed";
  await store.saveAnalysis({
    id: runId,
    ...key,
    releaseId: input.releaseId,
    generation: input.generation,
    inputArtifactId: manifest.id,
    evidenceIds: input.evidence.map((item) => item.id),
    output: validation.output,
    validationReport: {
      ...validation,
      parserVersion: input.recipe.parserVersion,
      attemptId: response.attemptId,
      responseArtifactId: response.responseArtifactId,
      usage: response.usage,
      finishReason: response.finishReason,
    },
    status,
  });
  return {
    status,
    runId,
    output: validation.output,
    errors: validation.errors,
  };
}

/** Reconstructs from stored bytes only. Missing or deleted artifacts never trigger collection. */
export async function replayAnalysis(
  store: AnalysisStore,
  inputArtifactId: string,
  execute: ExecuteGeneration,
  options: { releaseId?: string; rerunId?: string } = {},
) {
  const artifact = await store.getArtifact(inputArtifactId);
  if (!artifact) throw new Error("missing_input");
  const saved: unknown = JSON.parse(
    Buffer.from(artifact.body).toString("utf8"),
  );
  if (
    !object(saved) ||
    !object(saved.recipe) ||
    !Array.isArray(saved.evidence) ||
    !Array.isArray(saved.messages) ||
    !Array.isArray(saved.context) ||
    !Array.isArray(saved.upstreamOutputs) ||
    !Array.isArray(saved.requiredEvidenceIds)
  )
    throw new Error("invalid_input_manifest");
  const input = saved as unknown as AnalysisInput;
  return runAnalysis(
    store,
    { ...input, releaseId: options.releaseId ?? input.releaseId },
    execute,
    options.rerunId ? { rerunId: options.rerunId } : {},
  );
}
