// Layer: orchestration. Owns the default application's durable paid boundary.
import "../assert-server";
import { WeftClient, type FetchResponse } from "@weft-labs/sdk";
import type { WeftTransport } from "../weft";
import { postgresDatabase } from "./db";
import { EnrichmentStore } from "./store";
import { collectWeft } from "./weft-transport";
import type { CollectionInput, CollectionStore } from "./collection";
import { DurableCaptureError } from "../weft-retry";

export type CaptureConfig = {
  scope: string;
  budgetId: string;
  generation: number;
  policies: Record<string, CollectionInput["policy"]>;
};

export function boundedWeftClient(apiKey: string) {
  return new WeftClient({
    apiKey,
    fetchApi: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(25000)])
          : AbortSignal.timeout(25000),
      }),
  });
}

export function capturedTransport(
  store: CollectionStore,
  client: WeftTransport,
  config: CaptureConfig,
  enabled: () => boolean,
): WeftTransport {
  return {
    async fetch(request) {
      if (!request.operationId || !config.policies[request.operationId])
        throw new Error("capture_policy_missing");
      const artifact = await collectWeft(
        store,
        client,
        {
          scope: config.scope,
          budgetId: config.budgetId,
          generation: config.generation,
          operation: request.operationId,
          mode: "acquire",
          policy: config.policies[request.operationId],
        },
        request,
        enabled,
      );
      const metadata = artifact.metadata;
      if (typeof metadata.status !== "number")
        throw new Error("capture_status_missing");
      // The generated SDK declares nullable receipt fields non-null. No fabricated
      // merchant or transaction is introduced when replaying the captured body.
      return {
        status: metadata.status,
        headers: {},
        bodyBase64: Buffer.from(artifact.body).toString("base64"),
        paidUsd: metadata.paidUsd,
        heldUsd: metadata.heldUsd,
        paymentStatus: metadata.paymentStatus,
        artifactId: metadata.providerArtifactId,
        txHash: null,
        merchant: null,
      } as unknown as FetchResponse;
    },
  };
}

/** No legacy fallback: a configured buyer key alone cannot purchase unarchived data. */
export function durableWeftClient(apiKey: string): WeftTransport {
  return {
    async fetch(request, options) {
      try {
        const connection = process.env.ENRICHMENT_DATABASE_URL;
        const rawConfig = process.env.ENRICHMENT_CAPTURE_CONFIG;
        if (
          !connection ||
          !rawConfig ||
          process.env.ENRICHMENT_ALLOW_PAID !== "1"
        )
          throw new Error("durable_capture_not_configured");
        const config = JSON.parse(rawConfig) as CaptureConfig;
        if (
          !config.scope ||
          !config.budgetId ||
          !Number.isSafeInteger(config.generation) ||
          config.generation < 0 ||
          !config.policies
        )
          throw new Error("invalid_capture_configuration");
        const db = postgresDatabase(connection);
        try {
          return await capturedTransport(
            new EnrichmentStore(db),
            boundedWeftClient(apiKey),
            config,
            () => process.env.ENRICHMENT_ALLOW_PAID === "1",
          ).fetch(request, options);
        } finally {
          await db.close();
        }
      } catch {
        // Keep the caller's queue intact for disabled, failed or ambiguous capture.
        // The durable ledger, not a legacy null/fallback, owns recovery.
        throw new DurableCaptureError();
      }
    },
  };
}
