// Accounted direct inference. Retained usage is an estimate, never a settled receipt.
import "../assert-server";
import { collectResponse, type CollectionInput } from "./collection";
import { canonicalJson, stableDigest } from "./contracts";
import type { EnrichmentStore } from "./store";
import {
  ENDPOINT,
  MODEL,
  MAX_REQUEST_BYTES,
  validateResponse,
  type Request,
  type ProviderResponse,
} from "../typesafe-poc";
export type RetainedDecisionInput = {
  runId: string;
  request: Request;
  recipeVersion: string;
  evidenceIds: string[];
};
export type RetainedDecision = {
  response: ProviderResponse;
  requestArtifactId: string;
  responseArtifactId: string;
  attemptId: string;
  estimatedCostMicros: string;
};
export type ExecuteRetainedDecision = (
  input: RetainedDecisionInput,
) => Promise<RetainedDecision>;
export function retainedJev(
  store: EnrichmentStore,
  config: {
    scope: string;
    budgetId: string;
    capMicros: string;
    policy: CollectionInput["policy"];
    mode: "acquire" | "replay";
    enabled: () => boolean;
    apiKey?: string;
    fetcher?: typeof fetch;
  },
): ExecuteRetainedDecision {
  return async (input) => {
    const body = canonicalJson(input.request),
      bytes = Buffer.byteLength(body);
    if (
      input.request.model !== MODEL ||
      bytes > MAX_REQUEST_BYTES ||
      !input.recipeVersion ||
      !input.evidenceIds.length ||
      new Set(input.evidenceIds).size !== input.evidenceIds.length
    )
      throw new Error("invalid_jev_request");
    const reservation = Math.max(1, Math.ceil(bytes * 0.042));
    if (
      !/^\d+$/.test(config.capMicros) ||
      BigInt(config.capMicros) < BigInt(reservation)
    )
      throw new Error("jev_cap_too_low");
    let requestArtifactId: string | undefined;
    const artifact = await collectResponse(
      {
        planCollection: (v) => store.planCollection(v),
        getReusableArtifact: (id) => store.getReusableArtifact(id),
        reserveAttempt: (v) => store.reserveAttempt(v),
        markDispatched: (id) => store.markDispatched(id),
        markUncertain: (id, reason) => store.markUncertain(id, reason),
        captureResponse: async (v) =>
          store.captureResponse({
            ...v,
            kind: "generation_response",
            metadata: {
              ...v.metadata,
              requestArtifactId,
              runId: input.runId,
              recipeVersion: input.recipeVersion,
              evidenceIds: input.evidenceIds,
              accounting: "usage-estimate-only",
            },
          }),
      },
      {
        scope: config.scope,
        operation: "typesafe-systemone",
        args: {
          requestHash: stableDigest(input.request),
          recipeVersion: input.recipeVersion,
          evidenceIds: input.evidenceIds,
          runId: input.runId,
        },
        generation: 0,
        budgetId: config.budgetId,
        capMicros: config.capMicros,
        mode: config.mode,
        policy: config.policy,
      },
      async () => {
        if (!config.apiKey) throw new Error("missing_jev_key");
        const requestArtifact = await store.putArtifact({
          kind: "generation_request",
          body: Buffer.from(body),
          contentType: "application/json",
          redactionVersion: "credential-free-request-v1",
          runId: input.runId,
          metadata: {
            endpoint: ENDPOINT,
            recipeVersion: input.recipeVersion,
            evidenceIds: input.evidenceIds,
          },
        });
        requestArtifactId = requestArtifact.id;
        const response = await (config.fetcher ?? fetch)(ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        const reader = response.body?.getReader(),
          parts: Uint8Array[] = [];
        let size = 0;
        if (reader)
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > 1_000_000) {
              await reader.cancel();
              throw new Error("jev_response_too_large");
            }
            parts.push(next.value);
          }
        return {
          body: Buffer.concat(parts),
          status: response.status,
          contentType:
            response.headers.get("content-type") ?? "application/octet-stream",
        };
      },
      { enabled: config.enabled },
    );
    if (
      typeof artifact.metadata.status !== "number" ||
      artifact.metadata.status < 200 ||
      artifact.metadata.status >= 300
    )
      throw new Error("jev_http_response_archived");
    const response = validateResponse(
      JSON.parse(Buffer.from(artifact.body).toString("utf8")),
      input.request,
    );
    if (
      typeof artifact.metadata.requestArtifactId !== "string" ||
      typeof artifact.metadata.attemptId !== "string" ||
      !(await store.getArtifact(artifact.metadata.requestArtifactId))
    )
      throw new Error("jev_request_capture_missing");
    if (
      BigInt(Math.ceil(response.usage.input_tokens * 0.042)) >
      BigInt(config.capMicros)
    )
      throw new Error("jev_usage_exceeded_reservation");
    return {
      response,
      requestArtifactId: artifact.metadata.requestArtifactId,
      responseArtifactId: artifact.id,
      attemptId: artifact.metadata.attemptId,
      estimatedCostMicros: String(
        Math.ceil(response.usage.input_tokens * 0.042),
      ),
    };
  };
}
