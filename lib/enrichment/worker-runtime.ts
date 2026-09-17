// Layer: adapter. Owns configured accounted worker exchanges, not processing policy.
import "../assert-server";
import type { WeftTransport } from "../weft";
import type { CollectionStore } from "./collection";
import type { CaptureConfig } from "./runtime";
import { collectWeft } from "./weft-transport";
import { weftGeneration, generationRoute } from "./generation";
import {
  collectWebsite as captureWebsite,
  WEBSITE_OPERATION,
  JINA_WEBSITE_OPERATION,
} from "./website";

export type WorkerTransportConfig = CaptureConfig & {
  sourceMaxCostUsd: string;
  modelMaxCostUsd: string;
  websiteMaxCostUsd?: string;
  embeddingEndpoint?: {
    url: string;
    operationId: string;
    accessMethodId: string;
    maxCostUsd: string;
    includeDimensions: boolean;
  };
};

export function workerAdapters(
  store: CollectionStore,
  client: WeftTransport,
  config: WorkerTransportConfig,
  enabled: () => boolean,
  modelProvider = "weft/openrouter",
) {
  const route = generationRoute(modelProvider);
  const executeGeneration = weftGeneration(store, client, {
    scope: config.scope,
    budgetId: config.budgetId,
    maxCostUsd: config.modelMaxCostUsd,
    policy: config.policies[route.operationId],
    enabled,
  });
  const collectProfile = async (input: {
    entityId: string;
    legacyKey: string | null;
    generation: number;
  }) => {
    if (!input.legacyKey || !/^[A-Za-z0-9_]{1,15}$/.test(input.legacyKey))
      return {
        status: "blocked" as const,
        reason: "missing_verified_source_handle",
      };
    const operation = "bazaar-x402-atlas-183";
    if (!config.policies[operation])
      return {
        status: "blocked" as const,
        reason: "source_policy_not_configured",
      };
    const artifact = await collectWeft(
      {
        planCollection: (value) => store.planCollection(value),
        getReusableArtifact: (id) => store.getReusableArtifact(id),
        reserveAttempt: (value) => store.reserveAttempt(value),
        markDispatched: (id) => store.markDispatched(id),
        markUncertain: (id, reason) => store.markUncertain(id, reason),
        captureResponse: (value) =>
          store.captureResponse({
            ...value,
            metadata: {
              ...value.metadata,
              sourceKind: "self-reported",
              observedAt: new Date().toISOString(),
            },
          }),
      },
      client,
      {
        scope: config.scope,
        budgetId: config.budgetId,
        generation: input.generation,
        operation,
        mode: "acquire",
        policy: config.policies[operation],
      },
      {
        url: `https://twitter.use.x402atlas.com/user-details?username=${encodeURIComponent(input.legacyKey)}`,
        method: "GET",
        headers: {},
        operationId: operation,
        accessMethodId: "bazaar-x402-atlas-183-x402",
        maxCostUsd: config.sourceMaxCostUsd,
      },
      enabled,
    );
    const status = artifact.metadata.status;
    if (typeof status !== "number" || status < 200 || status >= 300)
      return {
        status: "unavailable" as const,
        reason: "source_http_failure",
        artifactId: artifact.id,
      };
    return { status: "captured" as const, artifactId: artifact.id };
  };
  const collectWebsite = async (input: {
    provider?: "exa" | "jina";
    entityId: string;
    generation: number;
    websiteUrl: string;
    sourceProfileArtifactId: string;
    maxExcerptChars?: number;
  }) => {
    const policy =
      config.policies[
        input.provider === "jina" ? JINA_WEBSITE_OPERATION : WEBSITE_OPERATION
      ];
    if (!policy || !config.websiteMaxCostUsd)
      return {
        status: "unavailable" as const,
        reason: "website_policy_not_configured",
      };
    const result = await captureWebsite(
      store,
      client,
      {
        scope: config.scope,
        budgetId: config.budgetId,
        generation: input.generation,
        mode: "acquire",
        policy,
        maxCostUsd: config.websiteMaxCostUsd,
        provider: input.provider,
        websiteUrl: input.websiteUrl,
        sourceProfileArtifactId: input.sourceProfileArtifactId,
        maxExcerptChars: input.maxExcerptChars,
      },
      enabled,
    );
    return result.status === "captured"
      ? { status: "captured" as const, artifactId: result.artifact.id }
      : {
          status: "unavailable" as const,
          reason: result.reason,
          ...(result.artifact ? { artifactId: result.artifact.id } : {}),
        };
  };
  const embed = config.embeddingEndpoint
    ? async (input: {
        entityId: string;
        analysisId: string;
        generation: number;
        text: string;
        templateVersion: string;
        model: string;
        modelVersion: string;
        dimensions: number;
      }) => {
        const endpoint = config.embeddingEndpoint!;
        const policy = config.policies[endpoint.operationId];
        if (!policy) throw new Error("embedding_policy_missing");
        const artifact = await collectWeft(
          store,
          client,
          {
            scope: config.scope,
            budgetId: config.budgetId,
            generation: 0,
            operation: endpoint.operationId,
            mode: "acquire",
            policy,
            requestIdentity: `${input.templateVersion}:${input.modelVersion}`,
          },
          {
            url: endpoint.url,
            operationId: endpoint.operationId,
            accessMethodId: endpoint.accessMethodId,
            method: "POST",
            headers: { "content-type": "application/json" },
            maxCostUsd: endpoint.maxCostUsd,
            body: JSON.stringify({
              model: input.model,
              input: input.text,
              ...(endpoint.includeDimensions
                ? { dimensions: input.dimensions }
                : {}),
            }),
          },
          enabled,
        );
        if (
          typeof artifact.metadata.status !== "number" ||
          artifact.metadata.status < 200 ||
          artifact.metadata.status >= 300
        )
          throw new Error("embedding_http_failure");
        const payload = JSON.parse(Buffer.from(artifact.body).toString("utf8"));
        const vector: unknown = payload.data?.[0]?.embedding;
        if (
          !Array.isArray(vector) ||
          vector.length !== input.dimensions ||
          !vector.every((n) => typeof n === "number" && Number.isFinite(n))
        )
          throw new Error("invalid_embedding_response");
        if (typeof artifact.metadata.attemptId !== "string")
          throw new Error("embedding_attempt_missing");
        return {
          vector: vector as number[],
          attemptId: artifact.metadata.attemptId,
          responseArtifactId: artifact.id,
        };
      }
    : undefined;
  return { executeGeneration, collectProfile, collectWebsite, embed };
}
