# Map and leaderboard draft

The header links to `/map`. Visitor requests never call paid providers.
MapLibre loads only on the map page.
[OpenFreeMap](https://openfreemap.org/quick_start/) supplies map tiles. A map
failure leaves the searchable founder list usable.

The map matches normalized city and country against a bundled
[GeoNames gazetteer](../lib/data/README.md). Pins are approximate city centers,
not personal addresses. Ambiguous names within the gazetteer and unsupported
locations stay in the list and count as unmapped. A city pin opens its paginated founder list. Search, country and craft filters
apply to both list and map.

## Leaderboard draft

The leaderboard is deferred until stored, source-backed engagement counts have
enough coverage for a useful ranking. `/leaderboard` returns 404 and is absent
from navigation and the sitemap. The page is preserved in
`app/_drafts/leaderboard.tsx`, a private Next.js folder with no public route.
The gated fictional preview remains available for design work; it is not evidence
that production has ranking data. Restore the public page only after reviewing
actual metric coverage and explicitly approving the leaderboard release.

The draft leaderboard sorts **X introduction likes or views**, descending, with handle
as a stable tiebreaker. There is no combined score or quality claim. Unknown
counts remain unranked; an observed zero is valid. Rows show the capture date and
link to the original introduction. Counts are snapshots, not real-time traffic.

Search responses preserve measured counts through the pending queue. After
materialization or hydration, the scan updates metrics only for the matching
introduction URL, including known founders encountered again. Older snapshots
cannot replace newer ones. Replacing an introduction clears the old metrics.
The schema adds one nullable `intro_metrics` JSONB column; existing rows remain
unranked until measured source counts are available. Collection cadence and
paid-request limits are unchanged.

## Replay existing source snapshots

No fresh paid fetch is needed if recorded pages contain counts. Prepare a private
JSON array from those sources, with the **original capture time**, for example:

```json
[
  {
    "handle": "example",
    "tweetId": "123",
    "likes": 12,
    "views": null,
    "observedAt": "2026-09-17T00:00:00Z"
  }
]
```

Validate without database access:

```sh
pnpm exec tsx scripts/import-intro-metrics.ts snapshots.json
```

After authorization for the target database, run the same command with `--apply`
and `DATABASE_URL` set. Only existing rows with matching source URLs change.
This does not create founders or make provider calls. Keep source files private;
do not commit real profile exports. Check affected metrics on the target after
applying. Counts with no source evidence must stay absent.

## Local visual review

Set `DIRECTORY_PREVIEW=1` on an isolated local server, then open
`/discovery-preview` or `/discovery-preview?mode=leaderboard`. These pages use
clearly labelled fictional data and return 404 without the flag. Unit tests cover
place matching, ranking and count parsing. Browser tests cover filters, selection,
ranking modes, map failure, no-key empty states and mobile layout.

## Public data boundary

There is no public `/api/founders` route. Directory and map responses
contain at most 48 founder cards. Live filters and pagination request a new page;
there is no hidden complete founder array or automatic next-page fetch. Profile
links do not prefetch additional profile data. Directory cards omit profile-only
source text, external links and analysis details.

The map overview exposes city centers and aggregate counts only. Clicking a city
opens its paginated founder list. Ranking, filtering and paging happen on the
server before rendering or serialization. The sitemap lists static pages only,
not a bulk list of profile URLs. Synthetic previews remain explicitly gated.

This removes convenient bulk extraction; it is not scrape prevention. Public HTML
and Next.js page responses remain readable by automated clients one page at a time.
No header checks, hidden endpoint names or robots.txt rules are treated as access
control. Strict scraping limits need edge-level request controls or authentication.
