import { WeftError, type FetchResponse, type PaidFetchRequest, type WeftClient } from "@weft-labs/sdk";

const ATTEMPTS = 3;
const transient = (status: number) => status === 502 || status === 504;
const hardStop = /balance|budget|policy|denied|denylist|price|cost|scope|auth|payment/;

function hasPayment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.paymentStatus === "pending" || row.payment_status === "pending" ||
    Number(row.paidUsd ?? row.paid_usd ?? 0) > 0 ||
    Number(row.heldUsd ?? row.held_usd ?? 0) > 0;
}

// Keep the original cap and key on all attempts. Idempotency is best-effort,
// not a guarantee of one charge. Never retry a receipt with money committed.
export async function fetchWithRetry(
  client: Pick<WeftClient, "fetch">,
  request: PaidFetchRequest,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<FetchResponse | null> {
  const options = { idempotencyKey: crypto.randomUUID() };
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const response = await client.fetch(request, options);
      if (!transient(response.status)) return response;
      console.warn("Weft upstream failure", { status: response.status, attempt: attempt + 1, artifactId: response.artifactId });
      if (hasPayment(response)) return response;
    } catch (error) {
      if (error instanceof WeftError) console.warn("Weft request failure", { status: error.status, code: error.code, requestId: error.requestId, attempt: attempt + 1 });
      // Unknown transport errors may have charged: do not replay them.
      if (!(error instanceof WeftError) ||
          hasPayment(error.details) ||
          hardStop.test(error.code.toLowerCase()) ||
          [401, 402, 403].includes(error.status) ||
          !(transient(error.status) || error.retryable)) return null;
    }
    if (attempt < ATTEMPTS - 1) await sleep(500 * 2 ** attempt);
  }
  return null;
}
