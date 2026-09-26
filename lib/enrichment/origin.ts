// Layer: persistence. Owns the eligible saved indexing post for profile display.
import "../assert-server";
import type { Sql } from "./db";

export async function withIndexingOrigin<
  T extends {
    handle: string;
    introText: string | null;
    introUrl: string | null;
  },
>(db: Sql, founder: T): Promise<T | null> {
  const result = await db.query<{
    entity_status: string;
    origin_status: string | null;
    eligible: boolean;
    excerpt: string | null;
    source_url: string | null;
  }>(
    `SELECT f.status AS entity_status, o.status AS origin_status,
      (e.id IS NOT NULL AND e.purged_at IS NULL AND a.purged_at IS NULL
       AND (a.expires_at IS NULL OR a.expires_at>now())
       AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals w WHERE w.artifact_id=a.id)) AS eligible,
      e.excerpt,e.source_url
     FROM enrichment_entities f
     LEFT JOIN enrichment_index_origins o ON o.founder_id=f.id
     LEFT JOIN enrichment_evidence e ON e.id=o.evidence_id
     LEFT JOIN enrichment_artifacts a ON a.id=e.artifact_id
     WHERE f.kind='founder' AND f.legacy_key=$1`,
    [founder.handle.toLowerCase()],
  );
  const origin = result.rows[0];
  if (!origin) return founder; // Intake has not imported this legacy row yet.
  if (origin.entity_status === "suppressed") return null;
  if (!origin.origin_status) return founder;
  const display =
    origin.eligible &&
    ["confirmed", "legacy-unverified"].includes(origin.origin_status);
  // An unknown, expired or withdrawn origin must not revive a mutable copy.
  return {
    ...founder,
    introText: display ? origin.excerpt : null,
    introUrl: display ? origin.source_url : null,
  };
}
