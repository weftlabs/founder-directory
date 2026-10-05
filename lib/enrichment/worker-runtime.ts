// Layer: adapter. Owns configured accounted worker exchanges, not processing policy.
import "../assert-server";
import type { WeftTransport } from "../weft";
import type { CollectionStore } from "./collection";
import type { CaptureConfig } from "./runtime";
import {
  localEmbeddingAdapter,
  LOCAL_EMBEDDING_OPERATION,
} from "./local-embedding";
import { collectWeft } from "./weft-transport";
import { extractProfile } from "./worker";
import { weftGeneration, generationRoute } from "./generation";
import {
  collectWebsite as captureWebsite,
  WEBSITE_OPERATION,
  JINA_WEBSITE_OPERATION,
} from "./website";

/** Cheapest first. Each source runs only when the operator approved its policy. */
export const PROFILE_SOURCES = [
  {
    // Profile plus up to 10 recent posts in one call.
    operation: "x402factory-xprofile",
    url: () => "https://x402factory.ai/base/xprofile",
    body: (handle: string) => JSON.stringify({ handle }),
    accessMethodId: null,
  },
  {
    operation: "twitsh-user-by-username",
    url: (handle: string) =>
      `https://x402.twit.sh/users/by/username?username=${handle}`,
    accessMethodId: null,
  },
  {
    operation: "bazaar-x402-atlas-183",
    url: (handle: string) =>
      `https://twitter.use.x402atlas.com/user-details?username=${handle}`,
    accessMethodId: "bazaar-x402-atlas-183-x402",
  },
] as const;

export const TWEETS_OPERATION = "bazaar-x402-atlas-187";

export type WorkerTransportConfig = CaptureConfig & {
  /** Re-send an uncertain attempt under its original key; Weft replays, never pays twice. */
  resumeUncertain?: boolean;
  sourceMaxCostUsd: string;
  modelMaxCostUsd: string;
  websiteMaxCostUsd?: string;
  localEmbedding?: { pythonExecutable: string; modelDirectory: string };
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
  if (config.localEmbedding && config.embeddingEndpoint)
    throw new Error("conflicting_embedding_transports");
  const route = generationRoute(modelProvider);
  const executeGeneration = weftGeneration(store, client, {
    scope: config.scope,
    budgetId: config.budgetId,
    maxCostUsd: config.modelMaxCostUsd,
    policy: config.policies[route.operationId],
    enabled,
    resumeUncertain: config.resumeUncertain,
  });
  const selfReportedStore: CollectionStore = {
    planCollection: (value) => store.planCollection(value),
    getReusableArtifact: (id) => store.getReusableArtifact(id),
    reserveAttempt: (value) => store.reserveAttempt(value),
    markDispatched: (id) => store.markDispatched(id),
    markUncertain: (id, reason) => store.markUncertain(id, reason),
    markNotCharged: (id, evidence) => store.markNotCharged(id, evidence),
    resumeUncertainAttempt: (value) => store.resumeUncertainAttempt(value),
    captureResponse: (value) =>
      store.captureResponse({
        ...value,
        metadata: {
          ...value.metadata,
          sourceKind: "self-reported",
          observedAt: new Date().toISOString(),
        },
      }),
  };
  const readable = (body: Uint8Array) => {
    try {
      extractProfile(body);
      return true;
    } catch {
      return false;
    }
  };
  const collectTweets = async (input: {
    entityId: string;
    legacyKey: string;
    generation: number;
  }) => {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(input.legacyKey))
      return { status: "unavailable" as const, reason: "invalid_handle" };
    if (!config.policies[TWEETS_OPERATION])
      return {
        status: "unavailable" as const,
        reason: "tweet_policy_not_configured",
      };
    const artifact = await collectWeft(
      selfReportedStore,
      client,
      {
        scope: config.scope,
        budgetId: config.budgetId,
        generation: input.generation,
        operation: TWEETS_OPERATION,
        mode: "acquire",
        policy: config.policies[TWEETS_OPERATION],
      },
      {
        url: `https://twitter.use.x402atlas.com/user-tweets?username=${input.legacyKey}`,
        method: "GET",
        headers: {},
        operationId: TWEETS_OPERATION,
        accessMethodId: `${TWEETS_OPERATION}-x402`,
        maxCostUsd: config.sourceMaxCostUsd,
      },
      enabled,
      { resumeUncertain: config.resumeUncertain },
    );
    const status = artifact.metadata.status;
    return typeof status === "number" && status >= 200 && status < 300
      ? { status: "captured" as const, artifactId: artifact.id }
      : {
          status: "unavailable" as const,
          reason: "tweet_http_failure",
          artifactId: artifact.id,
        };
  };
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
    const handle = encodeURIComponent(input.legacyKey);
    const sources = PROFILE_SOURCES.filter(
      (source) => config.policies[source.operation],
    );
    if (!sources.length)
      return {
        status: "blocked" as const,
        reason: "source_policy_not_configured",
      };
    let failure: {
      status: "unavailable";
      reason: string;
      artifactId: string;
    } | null = null;
    for (const source of sources) {
      const artifact = await collectWeft(
        selfReportedStore,
        // Weft does not index every source; it then receives the plain URL.
        source.accessMethodId
          ? client
          : {
              fetch: (request, options) =>
                client.fetch({ ...request, operationId: undefined }, options),
            },
        {
          scope: config.scope,
          budgetId: config.budgetId,
          generation: input.generation,
          operation: source.operation,
          mode: "acquire",
          policy: config.policies[source.operation],
        },
        {
          url: source.url(handle),
          ...("body" in source
            ? {
                method: "POST" as const,
                headers: { "content-type": "application/json" },
                body: source.body(input.legacyKey),
              }
            : { method: "GET" as const, headers: {} }),
          operationId: source.operation,
          ...(source.accessMethodId
            ? { accessMethodId: source.accessMethodId }
            : {}),
          maxCostUsd: config.sourceMaxCostUsd,
        },
        enabled,
        { resumeUncertain: config.resumeUncertain },
      );
      const status = artifact.metadata.status;
      const ok = typeof status === "number" && status >= 200 && status < 300;
      if (ok && readable(artifact.body))
        return { status: "captured" as const, artifactId: artifact.id };
      failure = {
        status: "unavailable" as const,
        reason: ok ? "source_unreadable" : "source_http_failure",
        artifactId: artifact.id,
      };
      // An unreadable success is not data, so the next source may run. Otherwise
      // only an uncharged failure falls back; a paid failure is never bought twice.
      if (!ok && !/^0*(\.0*)?$/.test(String(artifact.metadata.paidUsd ?? "0")))
        break;
    }
    return failure!;
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
  const embed = config.localEmbedding
    ? localEmbeddingAdapter(store, {
        ...config.localEmbedding,
        scope: config.scope,
        budgetId: config.budgetId,
        policy: config.policies[LOCAL_EMBEDDING_OPERATION],
        enabled,
      })
    : config.embeddingEndpoint
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
            { resumeUncertain: config.resumeUncertain },
          );
          if (
            typeof artifact.metadata.status !== "number" ||
            artifact.metadata.status < 200 ||
            artifact.metadata.status >= 300
          )
            throw new Error("embedding_http_failure");
          const payload = JSON.parse(
            Buffer.from(artifact.body).toString("utf8"),
          );
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
  return {
    executeGeneration,
    collectProfile,
    collectTweets,
    collectWebsite,
    embed,
  };
}
