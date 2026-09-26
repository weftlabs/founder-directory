import {
  WeftError,
  type FetchResponse,
  type PaidFetchRequest,
  type WeftClient,
} from "@weft-labs/sdk";

const ATTEMPTS = 3;
const transient = (status: number) => status === 502 || status === 504;
const hardStop =
  /balance|budget|policy|denied|denylist|price|cost|scope|auth|payment/;

// A capture/configuration failure is not evidence that a profile does not exist.
// Propagate this safe marker without retrying or exposing the underlying error.
export class DurableCaptureError extends Error {
  constructor() {
    super("durable_capture_unavailable");
    this.name = "DurableCaptureError";
  }
}

function hasPayment(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const row = value as Record<string, unknown>;
  for (const key of ["paymentStatus", "payment_status"]) {
    if (
      typeof row[key] === "string" &&
      /^(pending|held|paid|authorized|processing)$/i.test(row[key])
    )
      return true;
  }
  for (const key of ["paidUsd", "paid_usd", "heldUsd", "held_usd"]) {
    if (!(key in row)) continue;
    const amount = row[key];
    // Only an explicit, valid zero is safe to replay. Do not hide one alias
    // behind another or coerce malformed receipt amounts to zero.
    if (
      (typeof amount !== "string" && typeof amount !== "number") ||
      (typeof amount === "string" && !/^0+(?:\.0+)?$/.test(amount.trim())) ||
      (typeof amount === "number" && amount !== 0)
    )
      return true;
  }
  // Error details can wrap the receipt, including a receipt array.
  return Object.values(row).some((nested) => hasPayment(nested, seen));
}

// Keep the original cap and key on all attempts. Idempotency is best-effort,
// not a guarantee of one charge. Never retry a receipt with money committed.
export async function fetchWithRetry(
  client: Pick<WeftClient, "fetch">,
  request: PaidFetchRequest,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  retryOptions: {
    attempts?: number;
    returnLastResponse?: boolean;
    throwLastTransientError?: boolean;
  } = {},
): Promise<FetchResponse | null> {
  const attempts = retryOptions.attempts ?? ATTEMPTS;
  const options = { idempotencyKey: crypto.randomUUID() };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await client.fetch(request, options);
      if (!transient(response.status)) return response;
      console.warn("Weft upstream failure", {
        status: response.status,
        attempt: attempt + 1,
      });
      if (hasPayment(response)) return response;
      if (attempt === attempts - 1 && retryOptions.returnLastResponse) {
        return response;
      }
    } catch (error) {
      if (error instanceof DurableCaptureError) throw error;
      if (error instanceof WeftError)
        console.warn("Weft request failure", {
          status: error.status,
          attempt: attempt + 1,
        });
      // Unknown transport errors may have charged: do not replay them.
      if (
        !(error instanceof WeftError) ||
        hasPayment(error.details) ||
        hardStop.test(error.code.toLowerCase()) ||
        [401, 402, 403].includes(error.status) ||
        !(transient(error.status) || error.retryable)
      )
        return null;
      if (attempt === attempts - 1 && retryOptions.throwLastTransientError) {
        throw error;
      }
    }
    if (attempt < attempts - 1) await sleep(500 * 2 ** attempt);
  }
  return null;
}
