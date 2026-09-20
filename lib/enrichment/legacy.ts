// Layer: persistence. Owns idempotent legacy intake; snapshots are not raw API data.
import "../assert-server";
import { readFile } from "node:fs/promises";
import type { Database } from "./db";
import { EnrichmentStore } from "./store";

export async function installLegacyIntake(db: Database) {
  const source = await readFile(
    new URL("../../migrations/002_legacy_intake.sql", import.meta.url),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(73422001)");
    const founders = await tx.query<{ present: boolean }>(
      "SELECT to_regclass('public.founders') IS NOT NULL AS present",
    );
    if (!founders.rows[0]?.present)
      throw new Error("founders_schema_required_before_intake_migration");
    const previous = await tx.query(
      "SELECT version FROM enrichment_migrations WHERE version=2",
    );
    if (!previous.rows.length) {
      await tx.query(source);
      await tx.query("INSERT INTO enrichment_migrations(version) VALUES(2)");
    }
  });
}

export async function importLegacyIntake(
  db: Database,
  scope: string,
  limit = 100,
) {
  if (!scope || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("invalid_import_scope");
  let imported = 0;
  for (let index = 0; index < limit; index++) {
    const processed = await db.transaction(async (tx) => {
      const item = (
        await tx.query<{
          founder_key: string;
          snapshot: Record<string, unknown>;
          origin_status: "confirmed" | "legacy-unverified" | "unknown";
        }>(
          "SELECT founder_key,snapshot,origin_status FROM enrichment_founder_intake WHERE imported_at IS NULL ORDER BY founder_key FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!item) return false;
      const store = new EnrichmentStore({
        query: tx.query.bind(tx),
        transaction: (fn) => fn(tx),
      });
      const entityId = await store.createEntity("founder", item.founder_key);
      const text =
        typeof item.snapshot.intro_text === "string"
          ? item.snapshot.intro_text
          : "";
      const url =
        typeof item.snapshot.intro_url === "string"
          ? item.snapshot.intro_url
          : "";
      const origin =
        /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/[0-9]{1,25}$/.exec(
          url,
        );
      const validOrigin =
        text.trim().length > 0 &&
        origin?.[1].toLowerCase() === item.founder_key.toLowerCase();
      const artifact = await store.putArtifact({
        kind: "legacy_import",
        body: Buffer.from(JSON.stringify(item.snapshot)),
        contentType: "application/json",
        redactionVersion: "founder-row-v1",
        importBatch: "directory-intake-v1",
        metadata: {
          kind: "database_snapshot",
          rawProviderDataAvailable: false,
          ...(validOrigin
            ? { sourceKind: "self-reported", observedAt: null }
            : {}),
        },
      });
      const evidenceId = await store.addEvidence({
        artifactId: artifact.id,
        extractorVersion: "founder-row-v1",
        locator: "$",
        ...(validOrigin
          ? { sourceUrl: url, sourceId: url.split("/").at(-1) }
          : {}),
        payload: item.snapshot,
        excerpt: text,
      });
      await store.linkEvidence(entityId, evidenceId, "legacy_profile");
      await store.recordOrigin(
        entityId,
        validOrigin ? evidenceId : null,
        validOrigin ? item.origin_status : "unknown",
      );
      // No intake release means leave this row pending. The transaction rolls back
      // so a later approved release cannot miss this founder.
      await store.intake(scope, entityId);
      await tx.query(
        "UPDATE enrichment_founder_intake SET imported_at=now() WHERE founder_key=$1",
        [item.founder_key],
      );
      return true;
    });
    if (!processed) break;
    imported++;
  }
  // A committed target is the durable scheduling intent. This is safe to repeat
  // after a crash between import and expansion into stage rows.
  await new EnrichmentStore(db).reconcileTargets(scope);
  return { imported };
}
