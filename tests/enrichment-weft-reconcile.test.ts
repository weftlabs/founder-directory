import assert from "node:assert/strict";
import { test } from "node:test";
import {
  purchasesByReservation,
  reconcileDecision,
  weftReservation,
  type WeftPurchase,
} from "../lib/enrichment/weft-reconcile";

const key = "00000000-0000-4000-8000-000000000001";
// sha256("fetch-v1\0" + "2" + "\0" + key), computed independently of this module.
const reservation =
  "1f10910530c39b63591d7d2d4072c57eb9eefbc254dce48791d40a266abe66b6";
const fingerprint = "a".repeat(64);
const now = new Date("2026-10-05T12:00:00Z");
const old = new Date("2026-10-05T10:00:00Z");
const recent = new Date("2026-10-05T11:59:00Z");
const purchase = (status: string, extra: Partial<WeftPurchase> = {}) => ({
  id: 7,
  status,
  amountUsd: "0.001",
  idempotencyKey: `${reservation}.${fingerprint}`,
  ...extra,
});
const attempt = (
  dispatchState: string,
  paymentState: string,
  createdAt = old,
  settledMicros: string | null = null,
) => ({ dispatchState, paymentState, createdAt, settledMicros });

test("Weft idempotency reservation matches the server's derivation", () => {
  assert.equal(weftReservation(2, key), reservation);
  const index = purchasesByReservation([
    purchase("settled"),
    purchase("rejected", {
      id: 8,
      idempotencyKey: `${reservation}.${fingerprint}.rejected.0011223344556677`,
    }),
    purchase("settled", { id: 9, idempotencyKey: "b".repeat(64) }),
  ]);
  assert.deepEqual(
    index.get(weftReservation(2, key))?.map((row) => row.id),
    [7, 8],
  );
});

test("a late x402 settlement corrects an attempt recorded as not charged", () => {
  assert.deepEqual(
    reconcileDecision(
      attempt("captured", "not_charged"),
      [purchase("settled")],
      now,
    ),
    { action: "correct", settledMicros: "1000", purchaseId: 7 },
  );
});

test("a signed purchase is never treated as not charged", () => {
  assert.deepEqual(
    reconcileDecision(
      attempt("captured", "pending"),
      [purchase("signed")],
      now,
    ),
    { action: "wait" },
  );
  assert.deepEqual(
    reconcileDecision(
      attempt("uncertain", "pending"),
      [purchase("signed")],
      now,
    ),
    { action: "wait" },
  );
});

test("pending captures settle at the Weft amount and failed holds release", () => {
  assert.deepEqual(
    reconcileDecision(
      attempt("captured", "pending"),
      [purchase("settled", { amountUsd: "0.002121" })],
      now,
    ),
    { action: "settle", settledMicros: "2121", purchaseId: 7 },
  );
  assert.deepEqual(
    reconcileDecision(
      attempt("captured", "pending"),
      [purchase("expired")],
      now,
    ),
    { action: "release" },
  );
});

test("a paid uncertain attempt is resumed under its key, never released", () => {
  assert.deepEqual(
    reconcileDecision(
      attempt("uncertain", "pending"),
      [purchase("settled")],
      now,
    ),
    { action: "resume", purchaseId: 7 },
  );
  assert.deepEqual(
    reconcileDecision(
      attempt("dispatching", "pending", recent),
      [purchase("settled")],
      now,
    ),
    { action: "wait" },
  );
});

test("an uncertain attempt with no purchase is not charged only after the quiet period", () => {
  assert.deepEqual(
    reconcileDecision(attempt("uncertain", "pending", recent), [], now),
    {
      action: "wait",
    },
  );
  assert.deepEqual(
    reconcileDecision(attempt("uncertain", "pending"), [], now),
    {
      action: "not_charged",
    },
  );
  assert.deepEqual(
    reconcileDecision(
      attempt("uncertain", "pending", recent),
      [purchase("rejected")],
      now,
    ),
    { action: "not_charged" },
  );
});

test("a settled ledger row that disagrees with Weft needs a person", () => {
  assert.deepEqual(
    reconcileDecision(
      attempt("captured", "settled", old, "1000"),
      [purchase("settled")],
      now,
    ),
    { action: "none" },
  );
  assert.equal(
    reconcileDecision(
      attempt("captured", "settled", old, "2000"),
      [purchase("settled")],
      now,
    ).action,
    "manual",
  );
});
