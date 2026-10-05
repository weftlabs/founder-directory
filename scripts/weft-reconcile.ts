// Reconciles Weft-routed ledger attempts against Weft purchase history.
// Reads Weft only (no fetch, no payment). Writes the ledger only with --apply.
import { WeftClient } from "@weft-labs/sdk";
import { postgresDatabase } from "../lib/enrichment/db";
import { EnrichmentStore } from "../lib/enrichment/store";
import {
  purchasesByReservation,
  reconcileDecision,
  weftReservation,
  type WeftPurchase,
} from "../lib/enrichment/weft-reconcile";

async function main() {
  const apply = process.argv.includes("--apply");
  const apiKey = process.env.WEFT_API_KEY;
  const connection = process.env.ENRICHMENT_DATABASE_URL;
  if (!apiKey || !connection)
    throw new Error("WEFT_API_KEY and ENRICHMENT_DATABASE_URL are required");
  const client = new WeftClient({ apiKey });
  const me = (await client.me()) as unknown as { data: { id: number } };
  const purchases: WeftPurchase[] = [];
  for (let page = 1; ; page++) {
    const result = (await client.purchases({
      page,
      perPage: 100,
    } as never)) as unknown as { data: WeftPurchase[] };
    purchases.push(...result.data);
    if (result.data.length < 100) break;
  }
  const index = purchasesByReservation(purchases);
  const db = postgresDatabase(connection);
  try {
    const store = new EnrichmentStore(db);
    // collectWeft always records accessMethodId; other collectors never reach Weft.
    const { rows } = await db.query<{
      id: string;
      client_key: string;
      dispatch_state: string;
      payment_state: string;
      settled_micros: string | null;
      created_at: Date;
    }>(
      "SELECT t.id,t.client_key,t.dispatch_state,t.payment_state,t.settled_micros::text,t.created_at FROM enrichment_collection_attempts t JOIN enrichment_collection_requests r ON r.id=t.request_id WHERE r.args ? 'accessMethodId' ORDER BY t.created_at",
    );
    const now = new Date();
    const summary: Record<string, { count: number; micros: bigint }> = {};
    for (const row of rows) {
      const decision = reconcileDecision(
        {
          dispatchState: row.dispatch_state,
          paymentState: row.payment_state,
          settledMicros: row.settled_micros,
          createdAt: row.created_at,
        },
        index.get(weftReservation(me.data.id, row.client_key)) ?? [],
        now,
      );
      const bucket = (summary[decision.action] ??= {
        count: 0,
        micros: BigInt(0),
      });
      bucket.count++;
      if ("settledMicros" in decision)
        bucket.micros += BigInt(decision.settledMicros);
      if (decision.action === "manual" || decision.action === "resume")
        console.log(JSON.stringify({ attemptId: row.id, ...decision }));
      if (!apply) continue;
      const evidence = (purchaseId?: number) =>
        purchaseId
          ? `Weft purchase ${purchaseId} matched by idempotency reservation`
          : "No unexpired Weft purchase under this idempotency reservation";
      const actor = "weft-reconcile";
      if (decision.action === "settle")
        await store.reconcileCapturedPayment(row.id, {
          paymentState: "settled",
          settledMicros: decision.settledMicros,
          actor,
          evidence: evidence(decision.purchaseId),
        });
      else if (decision.action === "release")
        await store.reconcileCapturedPayment(row.id, {
          paymentState: "not_charged",
          settledMicros: "0",
          actor,
          evidence: evidence(),
        });
      else if (decision.action === "correct")
        await store.correctNotCharged(row.id, {
          settledMicros: decision.settledMicros,
          actor,
          evidence: evidence(decision.purchaseId),
        });
      else if (decision.action === "not_charged")
        await store.reconcileNotCharged(row.id, {
          actor,
          evidence: evidence(),
        });
    }
    console.log(
      JSON.stringify({
        mode: apply ? "apply" : "dry-run",
        attempts: rows.length,
        purchases: purchases.length,
        actions: Object.fromEntries(
          Object.entries(summary).map(([action, { count, micros }]) => [
            action,
            { count, usd: (Number(micros) / 1e6).toFixed(6) },
          ]),
        ),
      }),
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "weft_reconcile_failed",
  );
  process.exit(1);
});
