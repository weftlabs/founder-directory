// Layer: persistence. A bounded read of published display fields; no collection.
import "./assert-server";
import { neon } from "@neondatabase/serverless";
import { readProductSnapshot } from "./product-snapshot";
import type { Sql } from "./enrichment/db";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_PAGE_SIZE,
  PRODUCT_TEXT_LIMIT,
  productCard,
  productPage,
  type ProductInput,
  type ProductPage,
  type ProductQuery,
} from "./products";

// Do not reuse a latest-analysis lookup: publication is an explicit decision.
// The eligibility view covers retained manifest/raw bytes; the extra evidence
// check also excludes independently purged evidence and suppressed source owners.
const eligible = `WITH eligible AS (
 SELECT a.id, a.evidence_ids, a.entity_id,
  (SELECT jsonb_object_agg(c->>'field', jsonb_build_object('value',CASE WHEN c->>'state'='supported' AND jsonb_typeof(c->'value')='string' THEN to_jsonb(left(c->>'value',${PRODUCT_TEXT_LIMIT})) ELSE 'null'::jsonb END,'state',c->'state','kind',c->'kind'))
   FROM jsonb_array_elements(a.output->'claims') c
   WHERE c->>'field' IN ('name','description','audience','domain','product_type','business_model','stage')) AS fields
 FROM enrichment_profiles p
 JOIN enrichment_eligible_analyses a ON a.id=p.analysis_id AND a.entity_id=p.entity_id
 JOIN enrichment_entities product ON product.id=p.entity_id AND product.kind='product' AND product.status='active'
 JOIN enrichment_releases release ON release.id=a.release_id AND release.status='approved'
 WHERE a.purpose='product_descriptions' AND a.status='succeeded'
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(a.evidence_ids) cited(id)
   JOIN enrichment_evidence e ON e.id::text=cited.id
   WHERE e.purged_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM enrichment_entity_evidence own JOIN enrichment_entities source ON source.id=own.entity_id
    WHERE own.evidence_id=e.id AND source.status<>'active'))
), projected AS (
 SELECT a.id,
 jsonb_build_object('name',fields->'name','description',fields->'description','audience',fields->'audience',
  'domain',fields->'domain','productType',fields->'product_type','businessModel',fields->'business_model','stage',fields->'stage',
  'website',(SELECT min(e.source_url) FROM jsonb_array_elements_text(a.evidence_ids) cited(id)
    JOIN enrichment_evidence e ON e.id::text=cited.id
    WHERE e.payload->>'sourceKind'='product-site'),
  'imageUrl',(SELECT min(e.payload->>'imageUrl') FROM jsonb_array_elements_text(a.evidence_ids) cited(id) JOIN enrichment_evidence e ON e.id::text=cited.id WHERE e.payload->>'sourceKind'='product-site'),
  'founders',f.handles) AS card,
 concat_ws(' ', coalesce(fields->'name'->>'value',''),coalesce(fields->'description'->>'value',''),coalesce(fields->'audience'->>'value',''),f.search) AS search,
 coalesce(fields->'name'->>'value','') AS name,
 concat_ws(' ',fields->'domain'->>'value',fields->'product_type'->>'value') AS taxonomy
 FROM eligible a
 JOIN LATERAL (
  SELECT jsonb_agg(DISTINCT founder.legacy_key ORDER BY founder.legacy_key) AS handles,
   string_agg(DISTINCT founder.legacy_key,' ' ORDER BY founder.legacy_key) AS search
  FROM enrichment_founder_products relation
  JOIN enrichment_entities founder ON founder.id=relation.founder_id AND founder.kind='founder' AND founder.status='active'
  JOIN enrichment_evidence evidence ON evidence.id=relation.evidence_id AND evidence.purged_at IS NULL
  JOIN enrichment_artifacts raw ON raw.id=evidence.artifact_id AND raw.purged_at IS NULL
  WHERE relation.product_id=a.entity_id AND founder.legacy_key ~ '^[a-zA-Z0-9_]{1,15}$'
  AND (raw.expires_at IS NULL OR raw.expires_at>now())
  AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals w WHERE w.artifact_id=raw.id)
  AND EXISTS(SELECT 1 FROM enrichment_entity_evidence l WHERE l.entity_id=founder.id AND l.evidence_id=evidence.id)
  AND NOT EXISTS(SELECT 1 FROM enrichment_entity_evidence own JOIN enrichment_entities source ON source.id=own.entity_id WHERE own.evidence_id=evidence.id AND source.status<>'active')
 ) f ON f.handles IS NOT NULL
), categorized AS (
 SELECT *, CASE ${PRODUCT_CATEGORIES.filter((c) => c.pattern)
   .map((c) => `WHEN taxonomy ~* '${c.pattern}' THEN '${c.id}'`)
   .join(" ")} ELSE 'uncategorized' END AS category FROM projected
), searched AS (SELECT * FROM categorized WHERE strpos(lower(search),lower($1))>0),
 filtered AS (SELECT * FROM searched WHERE $2='' OR category=$2),
 totals AS (SELECT count(*)::integer AS total FROM filtered),
 paging AS (SELECT total, greatest(1,ceil(total::numeric/${PRODUCT_PAGE_SIZE})::integer) AS pages,
 least($3::integer,greatest(1,ceil(total::numeric/${PRODUCT_PAGE_SIZE})::integer)) AS page FROM totals)
 SELECT total,page,pages,
 coalesce((SELECT jsonb_agg(card ORDER BY name COLLATE "C",id) FROM (SELECT card,name,id FROM filtered ORDER BY name COLLATE "C",id LIMIT ${PRODUCT_PAGE_SIZE} OFFSET ((SELECT page FROM paging)-1)*${PRODUCT_PAGE_SIZE}) selected),'[]'::jsonb) AS products,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',category,'count',count)) FROM (SELECT category,count(*)::integer AS count FROM searched GROUP BY category) counts),'[]'::jsonb) AS categories
 FROM paging`;
export async function readProductPage(
  db: Sql,
  query: ProductQuery,
): Promise<ProductPage> {
  const { rows } = await db.query<
    Omit<ProductPage, "products"> & { products: ProductInput[] }
  >(eligible, [query.q, query.category, query.page]);
  const result = rows[0];
  return { ...result, products: result.products.map(productCard) };
}
export type LoadedProducts = ProductPage & {
  unavailable: boolean;
  preview: "local" | null;
};
export async function loadProducts(
  query: ProductQuery,
  env: Record<string, string | undefined> = process.env,
): Promise<LoadedProducts> {
  const empty = productPage([], query);
  if (env.PRODUCTS_LOCAL_SNAPSHOT) {
    // Explicit preview never falls through to a live database, including on hosts
    // where preview access is prohibited or the snapshot is invalid.
    if (env.NODE_ENV !== "development" || env.VERCEL)
      return { ...empty, unavailable: true, preview: null };
    try {
      const parsed = await readProductSnapshot(env);
      return {
        ...productPage(parsed.products.map(productCard), query),
        unavailable: false,
        preview: "local",
      };
    } catch {
      return { ...empty, unavailable: true, preview: "local" };
    }
  }
  if (!env.DATABASE_URL) return { ...empty, unavailable: false, preview: null };
  try {
    const sql = neon(env.DATABASE_URL, {
      fetchOptions: { signal: AbortSignal.timeout(10000) },
    });
    const db: Sql = {
      async query<T>(text: string, values?: unknown[]) {
        return { rows: (await sql.query(text, values)) as T[] };
      },
    };
    return {
      ...(await readProductPage(db, query)),
      unavailable: false,
      preview: null,
    };
  } catch {
    return { ...empty, unavailable: true, preview: null };
  }
}
