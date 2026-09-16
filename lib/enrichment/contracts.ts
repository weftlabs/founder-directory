// Layer: domain. Owns immutable, serializable enrichment boundary values.
import { createHash } from "node:crypto";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Canonical JSON fails closed instead of silently dropping unsupported values. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function serialize(item: unknown): string {
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item))
      return JSON.stringify(item);
    if (typeof item !== "object" || item === null || ancestors.has(item))
      throw new Error("invalid_JSON_value");
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error("invalid_JSON_object");
    if (Object.getOwnPropertySymbols(item).length)
      throw new Error("invalid_JSON_symbol_key");
    ancestors.add(item);
    let result: string;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length)
        throw new Error("invalid_JSON_array");
      result = `[${item.map(serialize).join(",")}]`;
    } else {
      const object = item as Record<string, unknown>;
      result = `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`)
        .join(",")}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return serialize(value);
}

export function stableDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** RFC 4122 UUIDv5 in the DNS namespace; the fixed prefix scopes application IDs. */
export function stableUuid(value: unknown): string {
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update(`founder-directory:${canonicalJson(value)}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface EvidenceInput {
  id: string;
  artifactId: string;
  contentHash: string;
  text: string;
  sourceUrl: string | null;
  extractorVersion: string;
}

export interface AnalysisRecipe {
  purpose: string;
  schemaVersion: string;
  parserVersion: string;
  promptVersion: string;
  template: string;
  provider: string;
  model: string;
  modelRevision: string | null;
  parameters: JsonValue;
  responseSchema: JsonValue;
  toolDefinitions: JsonValue[];
  codeDigest: string;
  selectionPolicy: string;
  claimFields?: {
    name: string;
    type: "string" | "string_array" | "product_array";
  }[];
}

export interface AnalysisMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string;
}

export interface AnalysisInput {
  entityId: string;
  subjectName?: string;
  releaseId: string;
  generation: number;
  recipe: AnalysisRecipe;
  evidence: EvidenceInput[];
  requiredEvidenceIds: string[];
  upstreamOutputs: { id: string; contentHash: string; output: JsonValue }[];
  messages: AnalysisMessage[];
  context: { id: string; contentHash: string; text: string; rank: number }[];
}

export interface RenderedAnalysisRequest {
  recipe: AnalysisRecipe;
  messages: AnalysisMessage[];
  context: AnalysisInput["context"];
  evidence: EvidenceInput[];
}

export interface PreparedAnalysis extends AnalysisInput {
  inputDigest: string;
  recipeDigest: string;
  manifest: {
    evidence: EvidenceInput[];
    upstreamOutputs: AnalysisInput["upstreamOutputs"];
    context: AnalysisInput["context"];
  };
  request: RenderedAnalysisRequest;
}

export interface AnalysisValidation {
  valid: boolean;
  errors: string[];
  output: JsonValue | null;
}

export interface EmbeddingInput {
  scope: string;
  text: string;
  templateVersion: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  distance: "cosine" | "euclidean" | "dot";
}
