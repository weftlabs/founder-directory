# Code guide

This guide helps external contributors navigate the source, not a private
platform architecture specification.

```text
app/                  Next.js routes and presentation
  directory.tsx       browser-side search; live index pages, in-memory preview
  site-header.tsx     shared product navigation
  analytics.tsx       optional PostHog; $pageview/$pageleave on App Router nav
  online-now.tsx      Neon heartbeat for the online chip (~20s ping, 45s window)
  api/founders/       public directory pages (filters + keyset cursor); no Weft
  api/cron/scan/      authenticated collection entry point
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
and `GET /api/founders` serves further pages and filter refetches. Pagination
is a keyset on `(updated_at DESC, handle DESC)`. Search and location filters
run in SQL and match the in-memory helpers in `directory-filters.ts`.
The client prefetches the next page as soon as a cursor exists and appends it
about 1200px before the list end, so scrolling does not wait on the network.
`/filter-preview` still passes a synthetic `founders` list so Playwright can
exercise chips without a database. Client filters never call Weft.
An authenticated scheduled request calls `runScan`: discover intros, ignore
known handles, hydrate new handles, normalize locations, then persist. Each
tick is bounded so it can return JSON and record `last_scan_at` inside
Vercel’s 300s cap: eight Weft searches and 15 hydrations on the schedule
(bulk is higher), plus a ~240s deadline. Per-phrase cursors and leftover
intros live on `scan_meta` so the next tick resumes history and hydrates
queued people first. Retweet-only pages do not stop pagination. Page count
is a per-phrase ceiling within the tick; found intros are not dropped to
meet the hydration cap — they wait for the next run.
If Atlas profile hydration returns HTTP 502 or 504, the scan stores a basic row
from the already-public intro result before it does more fallible work. This
prevents loss and a second paid request. Other profile failures are skipped,
including protected profiles. Uncertain places are empty, not comma-split
guesses. The original intro links back to its source.
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
