# Products

`/products` lists published product descriptions, separate from founder profiles.
Search matches product names, descriptions, audiences and linked founder handles.
Category links and search keep filters in the URL and reset pagination. Each page
contains at most 12 cards. Category counts follow the search across all categories;
the result count follows both search and the selected category.

## Saved data

The server reads the existing enrichment schema in `DATABASE_URL`. It makes no
provider calls, writes or migrations. Install and verify the enrichment schema
through the [operator workflow](enrichment.md) before enabling the database.
A database without that schema shows a Products unavailable state. A local app
without a database shows an empty state. Neither case prevents founder browsing.

The reader follows `enrichment_profiles.analysis_id`, not the newest analysis.
A product must have a succeeded `product_descriptions` analysis from an approved
release, an active identity and an eligible founder relationship. Every read checks
source retention, withdrawal and suppression, including independently purged
evidence and suppressed evidence owners. Founder links also require retained
relationship evidence. Publication does not imply that all founders have products.

Only selected display claims, eligible founder handles and cited product-site URLs
leave the query. Raw responses, manifests, evidence IDs and private entity IDs do
not reach the page. Unsafe URL schemes and credentials are removed. Website links
are omitted when a product has no eligible cited product-site URL. Founder links
lead to `/u/<handle>`.

Unknown, conflicting, stale and absent values are not displayed as facts. Inferred
supported values carry an `Inferred` label. Business model and stage stay separate
from category. Taxonomy version 1 uses an ordered keyword map of supported business
domain and product-type claims, with an Uncategorized fallback. These categories
are navigation aids, not quality ratings. The shared rule table is in
[`lib/products.ts`](../lib/products.ts). Claim text is bounded to 2,400 Unicode
characters before search, category mapping and display. The SQL reader and local
preview use the same bounds.

## No-key previews

For fictional fixtures, start the app with `DIRECTORY_PREVIEW=1` and open
`/products-preview`. This route is labeled synthetic, has no database dependency,
and is excluded from indexing. Production-mode browser tests use this route.

For an explicitly prepared local display snapshot, set `PRODUCTS_LOCAL_SNAPSHOT`
to its absolute path and run `pnpm dev`. Open `/products`. The app accepts this mode
only in development and when `VERCEL` is unset. It always shows a local preview
label. An invalid or prohibited snapshot shows unavailable; it never falls back
to `DATABASE_URL`. Preview founder links lead to public X profiles because the
local founder database may be absent. This does not publish or approve records.

The JSON contract is `{ "version": 1, "products": [...] }`, with at most 200
products and a 1 MB file limit. Each product has `name`, `description`, `audience`,
`domain`, `productType`, `businessModel` and `stage` claim objects, plus
`website: string | null` and `founders: string[]` handles. A claim contains
`value: string | null`, `state` (`supported`, `unknown`, `conflict`, `stale`, or
`absent`) and `kind` (`self_report`, `publisher_statement`, or `inference`).
`domain` is a business domain, never a website URL. Prepare snapshots only from
permitted saved display claims. Keep private snapshots in ignored `.local/`, not
in fixtures or version control.

## Tests and limits

`tests/product-data.test.ts` runs the actual query through PGlite with synthetic
records. It covers publication, release, source and relationship gates, safe
projection, literal search, category parity, counts and bounded pages.
`tests/products.test.ts` covers the pure display rules.
`tests/e2e/products.spec.ts` covers desktop and mobile navigation, search,
category changes, pagination, history and empty states with no paid calls.
These tests do not install a production schema or establish enrichment coverage.
