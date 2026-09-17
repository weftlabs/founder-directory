// Layer: orchestration. Owns accounted model execution through the capture boundary.
import "../assert-server";
import type { ExecuteGeneration } from "./analysis";
import type { CollectionInput, CollectionStore } from "./collection";
import type { WeftTransport } from "../weft";
import { canonicalJson, type JsonValue } from "./contracts";
import { collectWeft } from "./weft-transport";

/** Route identity is explicit; changing providers requires a matching reviewed policy. */
export function generationRoute(provider: string) {
  switch (provider) {
    case "weft/openrouter":
      return {
        url: "https://openrouter.mpp.tempo.xyz/v1/chat/completions",
        operationId: "openrouter-chat-completions",
        accessMethodId: "mpp-access-23-0-0",
      };
    case "weft/blockrun":
      return {
        url: "https://blockrun.ai/api/v1/chat/completions",
        operationId: "blockrun-chat-completions",
        accessMethodId: "blockrun-chat-x402-base",
      };
    default:
      throw new Error("unsupported_model_provider");
  }
}

export function weftGeneration(
  store: CollectionStore,
  client: WeftTransport,
  config: {
    scope: string;
    budgetId: string;
    maxCostUsd: string;
    policy: CollectionInput["policy"];
    enabled: () => boolean;
  },
): ExecuteGeneration {
  return async ({ runId, request }) => {
    if (request.recipe.toolDefinitions.length)
      throw new Error("tool_execution_not_enabled");
    const route = generationRoute(request.recipe.provider);
    const parameters = request.recipe.parameters;
    if (
      !parameters ||
      Array.isArray(parameters) ||
      typeof parameters !== "object"
    )
      throw new Error("invalid_model_parameters");
    const body = {
      ...parameters,
      model: request.recipe.modelRevision ?? request.recipe.model,
      messages: request.messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "founder_analysis",
          strict: true,
          schema:
            (request as typeof request & { responseSchema?: JsonValue })
              .responseSchema ?? request.recipe.responseSchema,
        },
      },
    };
    const artifact = await collectWeft(
      store,
      client,
      {
        scope: config.scope,
        budgetId: config.budgetId,
        generation: 0,
        operation: route.operationId,
        policy: config.policy,
        mode: "acquire",
        requestIdentity: runId,
      },
      {
        ...route,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: canonicalJson(body),
        maxCostUsd: config.maxCostUsd,
      },
      config.enabled,
    );
    if (
      typeof artifact.metadata.status !== "number" ||
      artifact.metadata.status < 200 ||
      artifact.metadata.status >= 300
    )
      throw new Error("model_http_failure_response_archived");
    const rawResponse = Buffer.from(artifact.body).toString("utf8");
    let usage: JsonValue = null;
    let finishReason: string | null = null;
    try {
      const envelope = JSON.parse(rawResponse);
      usage = envelope.usage ?? null;
      finishReason = envelope.choices?.[0]?.finish_reason ?? null;
    } catch {
      /* Invalid bodies are still returned to the validation stage. */
    }
    if (typeof artifact.metadata.attemptId !== "string")
      throw new Error("missing_attempt_link");
    return {
      attemptId: artifact.metadata.attemptId,
      rawResponse,
      responseArtifactId: artifact.id,
      usage,
      finishReason,
    };
  };
}
