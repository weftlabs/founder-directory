# Code guide

This guide helps external contributors navigate the source, not a private
platform architecture specification.

```text
app/                  Next.js routes and presentation
  directory.tsx       page navigation and filters; in-memory synthetic preview
  site-header.tsx     shared product navigation
  analytics.tsx       optional PostHog; $pageview/$pageleave on App Router nav
  online-now.tsx      Neon heartbeat for the online chip (~20s ping, 45s window)
  api/cron/discover/  search latest intros; queue leftover handles
  api/cron/hydrate/   enrich queued intros (Pro maxDuration 800s)
  api/cron/scan/      combined/bulk operator path; not on the schedule
  api/presence/       anonymous session heartbeat; no Weft
lib/
  model.ts            pure founder types and heuristics
  directory-filters.ts  URL filter parsing and in-memory matching
  directory-page.ts   cursor encode/decode and empty page JSON
  presence.ts         anonymous session-id shape for the online chip
  scan.ts             collection workflow
  db.ts               Neon persistence, including listDirectoryPage
  x.ts                X search/profile adapter through Weft
  place.ts            location normalization through Weft
  weft.ts             server-side Weft client boundary
  weft-retry.ts       bounded payment-aware retry policy
scripts/              explicit operator tasks and repository checks
tests/                synthetic unit contracts and browser smoke
```

## Default data flow

A visitor reads stored founders from Neon. The homepage SSRs one page of 48
and further pages and filters use document navigation. No public founder JSON API
is available. Pagination
is a keyset on `(updated_at DESC, handle DESC)`. Search and location filters
run in SQL and match the in-memory helpers in `directory-filters.ts`.
The client receives only the current 48 cards, with source text, external links
and analysis details omitted. There is no next-page data prefetch.
`/filter-preview` still passes a synthetic `founders` list so Playwright can
exercise chips without a database. Client filters never call Weft.
An authenticated discover job searches latest intros and queues unknown
handles. A separate hydrate job enriches that queue (profile + places).
Discover runs every five minutes (120s cap, no hydrations). Hydrate runs
four times an hour, offset from discover, with an 800s Pro Fluid limit
and a 780s deadline so one tick can enrich more than 15 people without a
plan upgrade. Combined `/api/cron/scan` remains for operator bulk.
Each tick still returns JSON and records `last_scan_at`. Per-phrase
cursors and leftover intros live on `scan_meta`. Found intros are not
dropped to meet the hydration cap — they wait for the next hydrate run.
If Atlas profile hydration returns HTTP 502 or 504, the scan leaves that
intro queued (or, if a stub row already exists, re-fetches it later). It
does not write an avatar-less founder row, because `existingHandles`
would then skip the person forever. After eight consecutive upstream
failures the tick stops so a 502 cluster does not spend the hydrate cap.
Other profile failures are skipped, including protected profiles.
The `scripts/materialize-pending.ts` operator command performs the same basic-row
write for intros that are already queued. It does not call Weft or replace scan
progress, so a concurrent scan cannot lose new cursors or queued intros.

The current discovery phrase is “I'm a solo founder”. That is one collection
seed, not the product name or a verified claim about every listed person. Keep
it explicit when changing discovery; do not silently change the data population
as part of a branding refactor.

## Change at the right boundary

- Put reusable deterministic logic in `lib/model.ts` and unit-test it.
- Keep provider contracts in adapters, not React components.
- Pass only display data across a client boundary. `pnpm check:repo` follows
  static imports from client components to reject server SDK/credential access.
- Use standard Next.js routes, links, metadata and component boundaries.
- Keep operational scripts separate from visitor request handlers.
- Do not add a generic framework until a second concrete use case needs it.

The database currently bootstraps its small schema on access; see the
[limitations](quality.md) before changing schema or promising migration safety.

## Discovery pages

[Founder map](discovery.md) documents geographic coverage and local previews. `lib/geography.ts` keeps the city
gazetteer on the server; `lib/discovery.ts` owns pure filtering and pagination.
`lib/discovery-data.ts` sends only display fields to the client.

## Products

[Products](products.md) documents published descriptions, category rules and local
previews. `lib/products.ts` owns pure display and navigation values;
`lib/product-data.ts` owns the bounded read-only projection. The Products route
and `app/products-view.tsx` render server components with standard GET filters.
