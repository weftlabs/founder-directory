# Builder DNA local preview

An opt-in local design and classification preview at `/lab/builder-dna`.
This does not replace production directory filters or profiles.

## Run locally

```sh
pnpm install --frozen-lockfile
BUILDER_DNA_PREVIEW=1 pnpm dev --port 3042
```

Open `http://127.0.0.1:3042/lab/builder-dna`.
Without the environment flag the route returns 404. No database or API credentials
are required. Do not copy production environment files.

The server reads `.local/builder-dna-examples.json` (gitignored). Without snapshots
the UI shows an empty state. Real-person snapshots stay local, out of source
control. Unit and browser fixtures are synthetic.

## What works

- Search and craft filtering with real links to one `/u/{handle}` page per founder.
- Server-rendered profile content and evidence, unique title/description, canonical URL,
  Open Graph/Twitter metadata and ProfilePage/Person JSON-LD. Local research pages
  stay noindex; production profile indexing policy is unchanged.
- Existing directory theme, shared header, card grid and profile panels.
- Separate craft, product, domain and working-style labels.
- A conservative deterministic classification pass over saved evidence excerpts.
- Explicit inferred labels, source-publisher claims and missing evidence.
- Source URLs and observation dates, with no invented activity, growth or scores.
- Existing category shown only as a before/after comparison, not endorsed.

`lib/builder-dna.ts` owns the data contract, input validation and preview rules.
`lib/builder-dna-local.ts` reads snapshots only on the server.
The preview does not call Weft, fetch live timelines, write Neon, or schedule jobs.
Initial examples are manually researched public-source excerpts, not paid API
results. Reading a product website verifies what that site says, not the truth
of its claims. A directory quotation of an X bio is not independent corroboration.

## Social preview images

Every `/u/{handle}` page advertises its own `/u/{handle}/share-image` PNG
through Open Graph and Twitter large-image metadata. Cards are rendered at
1200×630 using the existing dark/lime theme and bundled IBM Plex Sans font.
The renderer reads stored data only; social crawler requests never buy enrichment.
Enriched examples show Builder DNA and product tags; ordinary imported profiles
fall back to their public bio/category without inventing enrichment. Unknown
profiles return 404. Initials are used rather than fetching untrusted avatar URLs.

Images can be reviewed locally by opening the image route directly. Social
platforms cannot fetch localhost; real unfurl validation requires an approved,
publicly reachable deployment. Platforms may cache older preview images.

## Verification

```sh
pnpm verify
```

The dedicated browser suite uses only synthetic fixtures via the server-side
`BUILDER_DNA_SNAPSHOT_FILE` override; it never overwrites local research data.

## Classification limitations

Rules are deliberately narrow for reviewing this concept, not a finished general
classifier. They must not replace production categorization unreviewed. Signatures
are editorial interpretations. Empty public data means unknown, not poor quality.
Source content can mention competitors, negation and future plans; the next
pipeline needs entity matching, structured claim extraction and evidence-linked
label decisions before batch enrichment.

## Next integration boundary

Use named server-side enrichment functions around the catalog-selected Weft
operations: X timeline, product extraction, optional linked GitHub/LinkedIn.
Before enabling paid requests, agree a pilot scope and aggregate budget; gate
calls by wallet policy, fixed endpoint contracts and per-call caps. Keep provider
receipts internal. Preserve raw responses separately from normalized evidence;
record publisher, observation date, claim kind, source URL and exact excerpt.
Do not retry ambiguous charges. Cache per company and refresh only stale signals.

A production launch still requires provider probes, identity resolution,
claim-level validation, durable storage, refresh policy, classifier evaluation,
and database migration review. No deployment is part of this local preview.
