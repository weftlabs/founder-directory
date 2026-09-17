// Layer: orchestration. Owns durable paid capture; uncertain dispatch never retries.
import "../assert-server";
import { createHash } from "node:crypto";

export type CapturedArtifact = {
  id: string;
  body: Uint8Array;
  metadata: Record<string, unknown>;
};

export interface CollectionStore {
  planCollection(input: {
    scope: string;
    fingerprint: string;
    generation: number;
    operation: string;
    args: Record<string, unknown>;
    policyId: string;
  }): Promise<{ id: string }>;
  getReusableArtifact(requestId: string): Promise<CapturedArtifact | null>;
  reserveAttempt(input: {
    requestId: string;
    budgetId: string;
    capMicros: string;
  }): Promise<{ id: string; clientKey: string; requestId: string }>;
  markDispatched(attemptId: string): Promise<unknown>;
  markUncertain(attemptId: string, reason: string): Promise<unknown>;
  captureResponse(input: {
    attemptId: string;
    body: Uint8Array;
    contentType: string;
    redactionVersion: string;
    paymentState: "pending" | "settled" | "not_charged" | "uncertain";
    settledMicros?: string;
    metadata?: Record<string, unknown>;
  }): Promise<CapturedArtifact>;
}

export type CollectionInput = {
  scope: string;
  operation: string;
  args: Record<string, unknown>;
  generation: number;
  budgetId: string;
  capMicros: string;
  mode: "acquire" | "replay";
  policy: {
    id: string;
    scope: string;
    operation: string;
    storageVerified: boolean;
    retentionApproved: boolean;
  };
};

export type ReceivedResponse = {
  capture?: {
    status: "complete" | "size_limit";
    limitBytes: number;
    observedBytes: number;
  };
  body: Uint8Array;
  status: number;
  contentType: string;
  paymentStatus?: string;
  paidUsd?: string;
  heldUsd?: string | null;
  artifactId?: number | null;
};

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        if (
          /authorization|cookie|api.?key|password|secret|token|signature/i.test(
            key,
          )
        )
          throw new Error("secret_argument");
        return `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`;
      })
      .join(",")}}`;
  }
  throw new Error("invalid_collection_argument");
}

function micros(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value))
    return null;
  const [whole, fractional = ""] = value.split(".");
  return (
    BigInt(whole) * BigInt(1000000) +
    BigInt(fractional.padEnd(6, "0"))
  ).toString();
}

function payment(response: ReceivedResponse) {
  const settledMicros = micros(response.paidUsd);
  const held = response.heldUsd == null ? "0" : micros(response.heldUsd);
  if (settledMicros === null || held === null)
    return { paymentState: "uncertain" as const };
  if (
    response.paymentStatus === "not_required" &&
    held === "0" &&
    settledMicros === "0"
  )
    return { paymentState: "not_charged" as const, settledMicros };
  if (response.paymentStatus === "settled" && held === "0")
    return { paymentState: "settled" as const, settledMicros };
  if (
    ["declined", "expired", "reverted"].includes(
      response.paymentStatus ?? "",
    ) &&
    settledMicros === "0"
  )
    return { paymentState: "not_charged" as const, settledMicros };
  return { paymentState: "pending" as const, settledMicros };
}

/** Capture only. Parsing is a separate operation on the durable returned artifact. */
export async function collectResponse(
  store: CollectionStore,
  input: CollectionInput,
  dispatch: (clientKey: string) => Promise<ReceivedResponse>,
  options: {
    enabled?: () => boolean;
    redact?: (body: Uint8Array) => Uint8Array;
    redactionVersion?: string;
  } = {},
): Promise<CapturedArtifact> {
  const { policy } = input;
  if (!["acquire", "replay"].includes(input.mode))
    throw new Error("invalid_collection_mode");
  if (!Number.isSafeInteger(input.generation) || input.generation < 0)
    throw new Error("invalid_collection_generation");
  if (
    typeof policy.id !== "string" ||
    !policy.id ||
    policy.retentionApproved !== true ||
    policy.storageVerified !== true ||
    policy.scope !== input.scope ||
    policy.operation !== input.operation
  )
    throw new Error("collection_policy_not_approved");
  if (!/^\d+$/.test(input.capMicros)) throw new Error("invalid_collection_cap");
  const fingerprint = createHash("sha256")
    .update(canonical({ operation: input.operation, args: input.args }))
    .digest("hex");
  const request = await store.planCollection({
    scope: input.scope,
    fingerprint,
    generation: input.generation,
    operation: input.operation,
    args: input.args,
    policyId: policy.id,
  });
  const cached = await store.getReusableArtifact(request.id);
  if (cached) return cached;
  if (input.mode === "replay") throw new Error("missing_input");
  if (options.enabled && !options.enabled())
    throw new Error("collection_disabled");
  const attempt = await store.reserveAttempt({
    requestId: request.id,
    budgetId: input.budgetId,
    capMicros: input.capMicros,
  });
  // Persist dispatch intent before crossing the external boundary. A failure here
  // leaves a reserved attempt, never an implicit authorization for another one.
  await store.markDispatched(attempt.id);
  try {
    if (options.enabled && !options.enabled())
      throw new Error("collection_disabled");
    const response = await dispatch(attempt.clientKey);
    const outcome = payment(response);
    return await store.captureResponse({
      attemptId: attempt.id,
      body: options.redact ? options.redact(response.body) : response.body,
      contentType: response.contentType,
      redactionVersion: options.redactionVersion ?? "credential-free-body-v1",
      ...outcome,
      metadata: {
        status: response.status,
        ...(response.capture ? { capture: response.capture } : {}),
        paymentStatus: response.paymentStatus ?? null,
        paidUsd: response.paidUsd ?? null,
        heldUsd: response.heldUsd ?? null,
        providerArtifactId: response.artifactId ?? null,
        paymentState: outcome.paymentState,
        attemptId: attempt.id,
      },
    });
  } catch {
    // Do not store credential-bearing exception strings or automatically retry.
    await store.markUncertain(attempt.id, "dispatch_or_capture_failed");
    throw new Error("collection_uncertain");
  }
}
