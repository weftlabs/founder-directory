// Layer: orchestration. Owns known-profile-URL capture and fail-closed text selection.
// Transport/storage failures propagate; unusable archived responses are unavailable.
import "../assert-server";
import { isIP } from "node:net";
import type { WeftTransport } from "../weft";
import type {
  CapturedArtifact,
  CollectionInput,
  CollectionStore,
} from "./collection";
import { collectWeft } from "./weft-transport";

export const WEBSITE_OPERATION = "exa-contents";
export type WebsiteInput = Omit<
  CollectionInput,
  "args" | "capMicros" | "operation"
> & {
  /** Caller must take this URL from the saved X profile, never model output. */
  websiteUrl: string;
  sourceProfileArtifactId: string;
  maxCostUsd: string;
  maxExcerptChars?: number;
};
export type WebsiteResult =
  | {
      status: "captured";
      artifact: CapturedArtifact;
      text: string;
      provenance: {
        sourceKind: "product-site";
        sourceProfileArtifactId: string;
        requestedUrl: string;
        returnedUrl: string;
        publishedDate: string | null;
        crawlDate: string | null;
        extractorVersion: "exa-text-v1";
        originalChars: number;
        truncated: boolean;
      };
    }
  | { status: "unavailable"; reason: string; artifact?: CapturedArtifact };

/** Conservative URL syntax gate, not a DNS/redirect safety guarantee by a provider. */
export function publicWebsiteUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, "");
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      isIP(host) ||
      host.includes(":") ||
      !host.includes(".") ||
      /(?:^|\.)(localhost|local|internal|test|invalid|onion)$/.test(host) ||
      !/^[a-z0-9.-]+$/.test(host) ||
      host
        .split(".")
        .some((part) => !part || part.startsWith("-") || part.endsWith("-"))
    )
      return null;
    for (const key of url.searchParams.keys()) {
      if (/key|token|secret|auth|signature|credential|password/i.test(key))
        return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Uses durable capture for both acquire and replay; never retries paid failures. */
export async function collectWebsite(
  store: CollectionStore,
  client: WeftTransport,
  input: WebsiteInput,
  enabled: () => boolean,
): Promise<WebsiteResult> {
  const requestedUrl = publicWebsiteUrl(input.websiteUrl);
  if (!requestedUrl || !input.sourceProfileArtifactId?.trim())
    return { status: "unavailable", reason: "missing_public_profile_website" };
  const limit = input.maxExcerptChars ?? 24000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000)
    throw new Error("invalid_website_excerpt_limit");
  const artifact = await collectWeft(
    store,
    client,
    {
      scope: input.scope,
      budgetId: input.budgetId,
      generation: input.generation,
      mode: input.mode,
      policy: input.policy,
      operation: WEBSITE_OPERATION,
    },
    {
      url: "https://api.exa.ai/contents",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: [requestedUrl], text: true }),
      operationId: WEBSITE_OPERATION,
      accessMethodId: "exa-contents-x402-base",
      maxCostUsd: input.maxCostUsd,
    },
    enabled,
  );
  return parseWebsiteArtifact(artifact, input);
}

/** Pure re-extraction from an archived provider response. No store or transport. */
export function parseWebsiteArtifact(
  artifact: CapturedArtifact,
  input: Pick<
    WebsiteInput,
    "websiteUrl" | "sourceProfileArtifactId" | "maxExcerptChars"
  >,
): WebsiteResult {
  const requestedUrl = publicWebsiteUrl(input.websiteUrl);
  if (!requestedUrl || !input.sourceProfileArtifactId?.trim())
    return {
      status: "unavailable",
      reason: "missing_public_profile_website",
      artifact,
    };
  const limit = input.maxExcerptChars ?? 24000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000)
    throw new Error("invalid_website_excerpt_limit");
  const unavailable = (reason: string): WebsiteResult => ({
    status: "unavailable",
    reason,
    artifact,
  });
  if (
    typeof artifact.metadata.status !== "number" ||
    artifact.metadata.status < 200 ||
    artifact.metadata.status >= 300
  )
    return unavailable("website_http_failure");
  let payload: Record<string, unknown> | null;
  try {
    payload = object(JSON.parse(Buffer.from(artifact.body).toString("utf8")));
  } catch {
    return unavailable("malformed_website_response");
  }
  if (
    !payload ||
    !Array.isArray(payload.statuses) ||
    !Array.isArray(payload.results)
  )
    return unavailable("missing_website_results");
  const matches = (value: unknown) =>
    typeof value === "string" && publicWebsiteUrl(value) === requestedUrl;
  const statuses = payload.statuses
    .map(object)
    .filter((item) => item && matches(item.id));
  if (statuses.length !== 1 || statuses[0]?.status !== "success")
    return unavailable("website_url_failed");
  // Exact association only: a redirect to another path/domain requires separate review.
  const results = payload.results
    .map(object)
    .filter(
      (item) =>
        item &&
        matches(item.url) &&
        (item.id === undefined || matches(item.id)),
    );
  if (results.length !== 1) return unavailable("website_url_mismatch");
  const result = results[0]!;
  if (typeof result.text !== "string" || !result.text.trim())
    return unavailable("missing_website_text");
  const text = result.text.trim();
  return {
    status: "captured",
    artifact,
    text: text.slice(0, limit),
    provenance: {
      sourceKind: "product-site",
      sourceProfileArtifactId: input.sourceProfileArtifactId,
      requestedUrl,
      returnedUrl: result.url as string,
      publishedDate:
        typeof result.publishedDate === "string" ? result.publishedDate : null,
      crawlDate: typeof result.crawlDate === "string" ? result.crawlDate : null,
      extractorVersion: "exa-text-v1",
      originalChars: text.length,
      truncated: text.length > limit,
    },
  };
}
