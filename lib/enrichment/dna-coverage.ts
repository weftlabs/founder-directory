// Activation-time proof only. Visitor requests must not scan the directory or collect DNA.
import "../assert-server";
import type { Sql } from "./db";
import { publicDirectoryHandleSql } from "../db";
import {
  linkedProductFounderFromSql,
  publishedProductAnalysisFromSql,
} from "../product-data";

/** Matches founder_dna_releases.expected_profiles. Do not raise either cap independently. */
export const DNA_RELEASE_PROFILE_LIMIT = 1000;
export const DNA_COVERAGE_REPORT_LIMIT = DNA_RELEASE_PROFILE_LIMIT;
const RELEASE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const PUBLIC_HANDLE = /^[a-z0-9_]{1,15}$/;
const REDACTED_HANDLE = /^invalid:[0-9a-f]{12}$/;
const GAP_REASONS = [
  "invalid_handle",
  "ambiguous_handle",
  "no_founder_entity",
  "not_eligible",
  "approved_portrait_not_in_release",
  "not_in_release",
] as const;
export type DnaCoverageReason = (typeof GAP_REASONS)[number];
export type DnaCoverageSource = "directory" | "product";
export type DnaCoverageGap = {
  handle: string;
  sources: DnaCoverageSource[];
  reason: DnaCoverageReason;
};
export type DnaCoverageCounts = {
  total: number;
  ready: number;
  missing: number;
};
export type DnaCoverageReport = {
  releaseId: string;
  limitation: "current_public_union_only";
  releaseProfileLimit: number;
  directory: DnaCoverageCounts;
  productLinked: DnaCoverageCounts;
  union: DnaCoverageCounts;
  missing: DnaCoverageGap[];
  missingTruncated: boolean;
};

function releaseId(value: string): string {
  if (!RELEASE_ID.test(value)) throw new Error("dna_coverage_invalid_release");
  return value;
}
function count(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`dna_coverage_unavailable:${label}`);
  return parsed;
}
function counts(
  total: number,
  ready: number,
  label: string,
): DnaCoverageCounts {
  if (ready > total) throw new Error(`dna_coverage_unavailable:${label}`);
  return { total, ready, missing: total - ready };
}
function gap(value: unknown): DnaCoverageGap {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("dna_coverage_unavailable:gap");
  const row = value as Record<string, unknown>;
  const handle = row.handle;
  const reason = row.reason;
  const sources = row.sources;
  if (
    typeof handle !== "string" ||
    (!PUBLIC_HANDLE.test(handle) && !REDACTED_HANDLE.test(handle)) ||
    typeof reason !== "string" ||
    !GAP_REASONS.includes(reason as DnaCoverageReason) ||
    !Array.isArray(sources) ||
    sources.some((source) => source !== "directory" && source !== "product")
  )
    throw new Error("dna_coverage_unavailable:gap");
  return {
    handle,
    reason: reason as DnaCoverageReason,
    sources: sources as DnaCoverageSource[],
  };
}

export async function readFounderDnaCoverage(
  db: Sql,
  requestedReleaseId: string,
): Promise<DnaCoverageReport> {
  const selected = releaseId(requestedReleaseId);
  const schema = (
    await db.query<{
      founders: string | null;
      entities: string | null;
      profiles: string | null;
      links: string | null;
      analyses: string | null;
      releases: string | null;
      staged: string | null;
      eligible: string | null;
      portraits: string | null;
    }>(
      `SELECT to_regclass('founders')::text AS founders,
        to_regclass('enrichment_entities')::text AS entities,
        to_regclass('enrichment_profiles')::text AS profiles,
        to_regclass('enrichment_founder_products')::text AS links,
        to_regclass('enrichment_eligible_analyses')::text AS analyses,
        to_regclass('founder_dna_releases')::text AS releases,
        to_regclass('founder_dna_release_profiles')::text AS staged,
        to_regclass('founder_dna_eligible_profiles')::text AS eligible,
        to_regclass('founder_dna_portrait_publications')::text AS portraits`,
    )
  ).rows[0];
  if (!schema?.founders)
    throw new Error("dna_coverage_directory_schema_missing");
  if (
    !schema.entities ||
    !schema.profiles ||
    !schema.links ||
    !schema.analyses ||
    !schema.releases ||
    !schema.staged ||
    !schema.eligible ||
    !schema.portraits
  )
    throw new Error("dna_coverage_schema_missing");
  if (
    !(
      await db.query("SELECT id FROM founder_dna_releases WHERE id=$1", [
        selected,
      ])
    ).rows.length
  )
    throw new Error("dna_coverage_release_not_found");
  const row = (
    await db.query<{
      directory_total: unknown;
      directory_ready: unknown;
      product_total: unknown;
      product_ready: unknown;
      union_total: unknown;
      union_ready: unknown;
      missing_count: unknown;
      missing: unknown;
    }>(
      `WITH directory AS (${publicDirectoryHandleSql()}),
 products AS (
  SELECT DISTINCT lower(founder.legacy_key) AS handle
  FROM (SELECT a.entity_id ${publishedProductAnalysisFromSql}) a
  JOIN LATERAL (SELECT founder.legacy_key ${linkedProductFounderFromSql}) founder ON true
 ), required AS (
  SELECT handle, bool_or(source='directory') AS in_directory, bool_or(source='product') AS in_product
  FROM (
    SELECT handle, 'directory' AS source FROM directory
    UNION ALL SELECT handle, 'product' AS source FROM products
  ) population GROUP BY handle
 ), entities AS (
  SELECT lower(legacy_key) AS handle, count(*)::integer AS matches,
    CASE WHEN count(*)=1 THEN min(id::text)::uuid END AS id
  FROM enrichment_entities WHERE kind='founder' GROUP BY lower(legacy_key)
 ), classified AS (
  SELECT required.handle, required.in_directory, required.in_product,
    CASE
      WHEN required.handle !~ '^[a-z0-9_]{1,15}$' THEN 'invalid_handle'
      WHEN entities.matches>1 THEN 'ambiguous_handle'
      WHEN entities.id IS NULL THEN 'no_founder_entity'
      WHEN eligible.entity_id IS NOT NULL THEN 'ready'
      WHEN staged.entity_id IS NOT NULL THEN 'not_eligible'
      WHEN portrait.entity_id IS NOT NULL THEN 'approved_portrait_not_in_release'
      ELSE 'not_in_release'
    END AS reason
  FROM required
  LEFT JOIN entities ON entities.handle=required.handle
  LEFT JOIN founder_dna_release_profiles staged ON staged.release_id=$1 AND staged.entity_id=entities.id AND entities.matches=1
  LEFT JOIN founder_dna_eligible_profiles eligible ON eligible.release_id=$1 AND eligible.entity_id=entities.id AND entities.matches=1
  LEFT JOIN founder_dna_portrait_publications portrait ON portrait.entity_id=entities.id AND entities.matches=1
 )
 SELECT count(*) FILTER (WHERE in_directory)::integer AS directory_total,
  count(*) FILTER (WHERE in_directory AND reason='ready')::integer AS directory_ready,
  count(*) FILTER (WHERE in_product)::integer AS product_total,
  count(*) FILTER (WHERE in_product AND reason='ready')::integer AS product_ready,
  count(*)::integer AS union_total,
  count(*) FILTER (WHERE reason='ready')::integer AS union_ready,
  count(*) FILTER (WHERE reason<>'ready')::integer AS missing_count,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
    'handle', CASE WHEN gap.reason='invalid_handle' THEN 'invalid:'||substr(md5(gap.handle),1,12) ELSE gap.handle END,
    'sources', CASE WHEN gap.in_directory THEN '["directory"]'::jsonb ELSE '[]'::jsonb END
      || CASE WHEN gap.in_product THEN '["product"]'::jsonb ELSE '[]'::jsonb END,
    'reason', gap.reason
  ) ORDER BY gap.handle) FROM (
    SELECT handle, in_directory, in_product, reason FROM classified
    WHERE reason<>'ready' ORDER BY handle LIMIT ${DNA_COVERAGE_REPORT_LIMIT}
  ) gap), '[]'::jsonb) AS missing
 FROM classified`,
      [selected],
    )
  ).rows[0];
  if (!row) throw new Error("dna_coverage_unavailable:row");
  const missingCount = count(row.missing_count, "missing");
  const parsedMissing = (
    typeof row.missing === "string" ? JSON.parse(row.missing) : row.missing
  ) as unknown;
  if (
    !Array.isArray(parsedMissing) ||
    parsedMissing.length > DNA_COVERAGE_REPORT_LIMIT
  )
    throw new Error("dna_coverage_unavailable:missing");
  const missing = parsedMissing.map(gap);
  if (missing.length > missingCount)
    throw new Error("dna_coverage_unavailable:missing");
  return {
    releaseId: selected,
    limitation: "current_public_union_only",
    releaseProfileLimit: DNA_RELEASE_PROFILE_LIMIT,
    directory: counts(
      count(row.directory_total, "directory"),
      count(row.directory_ready, "directory_ready"),
      "directory",
    ),
    productLinked: counts(
      count(row.product_total, "product"),
      count(row.product_ready, "product_ready"),
      "product",
    ),
    union: counts(
      count(row.union_total, "union"),
      count(row.union_ready, "union_ready"),
      "union",
    ),
    missing,
    missingTruncated: missingCount > missing.length,
  };
}

export async function assertFounderDnaCoverage(
  db: Sql,
  requestedReleaseId: string,
): Promise<void> {
  const report = await readFounderDnaCoverage(db, requestedReleaseId);
  if (report.union.total > report.releaseProfileLimit)
    throw new Error("dna_coverage_exceeds_release_limit");
  if (report.union.missing > 0) throw new Error("dna_coverage_incomplete");
}
