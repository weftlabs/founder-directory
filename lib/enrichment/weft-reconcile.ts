// Layer: domain. Owns how a ledger attempt maps to its Weft purchase. No I/O.
import { createHash } from "node:crypto";
import { micros } from "./collection";

export type WeftPurchase = {
  id: number;
  status: string;
  amountUsd: string;
  idempotencyKey: string | null;
  artifact?: unknown;
};

export type LedgerAttempt = {
  dispatchState: string;
  paymentState: string;
  settledMicros: string | null;
  createdAt: Date;
};

export type ReconcileAction =
  | { action: "settle"; settledMicros: string; purchaseId: number }
  | { action: "correct"; settledMicros: string; purchaseId: number }
  | { action: "release" }
  | { action: "not_charged" }
  | { action: "resume"; purchaseId: number }
  | { action: "wait" }
  | { action: "manual"; why: string }
  | { action: "none" };

/**
 * Weft never stores the caller's Idempotency-Key. It stores
 * `sha256("fetch-v1\0" + userId + "\0" + key) + "." + sha256(request)`, and a
 * rejected attempt adds `.rejected.<hex>`. The first segment identifies the key.
 */
export function weftReservation(userId: number | string, clientKey: string) {
  return createHash("sha256")
    .update(`fetch-v1\0${userId}\0${clientKey}`)
    .digest("hex");
}

export function purchasesByReservation(purchases: WeftPurchase[]) {
  const index = new Map<string, WeftPurchase[]>();
  for (const purchase of purchases) {
    const reservation = purchase.idempotencyKey?.split(".")[0];
    if (!reservation) continue;
    index.set(reservation, [...(index.get(reservation) ?? []), purchase]);
  }
  return index;
}

const FAILED = new Set(["expired", "declined", "reverted", "rejected"]);
// A missing purchase is final only after Weft has had time to write its audit row.
const QUIET_MS = 60 * 60 * 1000;

/** `signed` is never final: x402 settles asynchronously, minutes after a merchant error. */
export function reconcileDecision(
  attempt: LedgerAttempt,
  purchases: WeftPurchase[],
  now: Date,
): ReconcileAction {
  const unresolvedDispatch = ["reserved", "dispatching", "uncertain"].includes(
    attempt.dispatchState,
  );
  const openPayment = ["pending", "uncertain"].includes(attempt.paymentState);
  const quiet = now.getTime() - attempt.createdAt.getTime() >= QUIET_MS;
  const paid = purchases.find((purchase) => purchase.status === "settled");
  if (paid) {
    const settledMicros = micros(paid.amountUsd);
    if (settledMicros === null)
      return { action: "manual", why: "unparseable purchase amount" };
    if (attempt.paymentState === "not_charged")
      return { action: "correct", settledMicros, purchaseId: paid.id };
    if (unresolvedDispatch)
      // In-flight calls are left alone; a stale one gets its body back by replay.
      return quiet
        ? { action: "resume", purchaseId: paid.id }
        : { action: "wait" };
    if (attempt.dispatchState === "captured" && openPayment)
      return { action: "settle", settledMicros, purchaseId: paid.id };
    if (attempt.settledMicros !== settledMicros)
      return { action: "manual", why: "ledger amount differs from Weft" };
    return { action: "none" };
  }
  if (purchases.some((purchase) => !FAILED.has(purchase.status)))
    return { action: "wait" };
  if (!purchases.length && !quiet) return { action: "wait" };
  if (attempt.dispatchState === "captured" && openPayment)
    return { action: "release" };
  if (unresolvedDispatch) return { action: "not_charged" };
  return { action: "none" };
}
