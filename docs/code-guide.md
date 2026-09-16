# Code guide

This guide helps external contributors navigate the source, not a private
platform architecture specification.

```text
app/                  Next.js routes and presentation
  directory.tsx       browser-side search and filter state
  site-header.tsx     shared product navigation
  analytics.tsx       optional PostHog; explicit $pageview on App Router nav
  online-now.tsx      Neon heartbeat for the online chip (~20s ping, 45s window)
  api/cron/scan/      authenticated collection entry point
  api/presence/       anonymous session heartbeat; no Weft
lib/
  model.ts            pure founder types and heuristics
  presence.ts         anonymous session-id shape for the online chip
  scan.ts             collection workflow
  db.ts               Neon persistence
  x.ts                X search/profile adapter through Weft
  place.ts            location normalization through Weft
  weft.ts             server-side Weft client boundary
  weft-retry.ts       bounded payment-aware retry policy
scripts/              explicit operator tasks and repository checks
tests/                synthetic unit contracts and browser smoke
```

## Default data flow

A visitor reads stored founders from Neon. Client-side filters never call Weft.
An authenticated scheduled request calls `runScan`: discover intros, ignore
known handles, hydrate every new handle found on those pages, normalize
locations, then persist. Page count bounds discovery; found intros are not
dropped to meet a second import quota.
Profiles whose upstream data is unavailable are skipped. Uncertain places are
empty, not comma-split guesses. The original intro links back to its source.

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
