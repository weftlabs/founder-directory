// Layer: adapter. Owns the SDK exchange; storage precedes any body parser.
import "../assert-server";
import type { PaidFetchRequest } from "@weft-labs/sdk";
import type { WeftTransport } from "../weft";
import {
  collectResponse,
  type CollectionInput,
  type CollectionStore,
} from "./collection";

export async function collectWeft(
  store: CollectionStore,
  client: WeftTransport,
  input: Omit<CollectionInput, "args" | "capMicros"> & {
    requestIdentity?: string;
  },
  request: PaidFetchRequest,
  enabled: () => boolean,
) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(request.maxCostUsd))
    throw new Error("invalid_collection_cap");
  const [whole, fraction = ""] = request.maxCostUsd.split(".");
  const capMicros = (
    BigInt(whole) * BigInt(1000000) +
    BigInt(fraction.padEnd(6, "0"))
  ).toString();
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("unsafe_collection_url");
  for (const key of url.searchParams.keys()) {
    if (/key|token|secret|auth|signature|credential/i.test(key))
      throw new Error("credential_in_collection_url");
  }
  url.searchParams.sort();
  if (request.operationId !== input.operation)
    throw new Error("collection_operation_mismatch");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    const normalized = key.toLowerCase();
    const readerHeader =
      request.operationId === "local-reviewed-jina-reader" &&
      url.origin === "https://r.jina.ai" &&
      ((normalized === "x-no-cache" && value === "true") ||
        (normalized === "x-robots-txt" && value === "FounderDirectory") ||
        (normalized === "dnt" && value === "true"));
    if (!["content-type", "accept"].includes(normalized) && !readerHeader)
      throw new Error("unsupported_collection_header");
    headers[key.toLowerCase()] = value;
  }
  // Include every semantic field in the fingerprint, never the account credential.
  const args = {
    url: url.toString(),
    method: request.method ?? "GET",
    headers,
    body: request.body ?? null,
    accessMethodId: request.accessMethodId ?? null,
    requestIdentity: input.requestIdentity ?? null,
  };
  return collectResponse(
    store,
    { ...input, args, capMicros },
    async (clientKey) => {
      // The durable key is an audit/reconciliation key, not a guarantee that the
      // upstream implements idempotency. No generic SDK retry wrapper is used.
      const response = await client.fetch(request, {
        idempotencyKey: clientKey,
      });
      return {
        body: Buffer.from(response.bodyBase64, "base64"),
        status: response.status,
        contentType:
          response.headers["content-type"] ?? "application/octet-stream",
        paymentStatus: response.paymentStatus,
        paidUsd: response.paidUsd,
        heldUsd: response.heldUsd,
        artifactId: response.artifactId,
      };
    },
    { enabled },
  );
}
