# Founder map

The header links to `/map`. Visitor requests never call paid providers.
MapLibre loads only on the map page.
[OpenFreeMap](https://openfreemap.org/quick_start/) supplies map tiles. A map
failure leaves the searchable founder list usable.

Photo pins use only the founders on the current page; missing or failed images
show initials. At wider zoom levels nearby points become numbered clusters;
portraits appear automatically when their points separate, without selection.
At city-region zoom levels, panning or zooming requests a new bounded page for the
visible area using the normal map page route. The camera stays in place. Mapped
founders take priority, with one representative per city before additional people
at the same location. At most 48 profiles are returned; no bulk API is added.
A shared city pin shows the number of founders on that page and
opens their chooser at wider zoom. At zoom 10 and closer, those profiles spread
into separate photo pins around the city center. Each pin selects one founder;
the visual offsets do not change the stored city coordinates. City aggregates still cover the full filtered map without
exposing additional identities. Pin counts are not ranks.

The map matches normalized city and country against a bundled
[GeoNames gazetteer](../lib/data/README.md). Pins are approximate city centers,
not personal addresses. Ambiguous names within the gazetteer and unsupported
locations stay in the list and count as unmapped. A city pin opens its paginated founder list. Search, country and craft filters
apply to both list and map.

## Local visual review

Set `DIRECTORY_PREVIEW=1` on an isolated local server, then open
`/discovery-preview`. This page uses
clearly labelled fictional data and return 404 without the flag. Unit tests cover
place matching and filtering. Browser tests cover selection,
map failure, no-key empty states and mobile layout.

## Public data boundary

There is no public `/api/founders` route. Directory and map responses
contain at most 48 founder cards. Live filters and pagination request a new page;
there is no hidden complete founder array or automatic next-page fetch. Profile
links do not prefetch additional profile data. Directory cards omit profile-only
source text, external links and analysis details.

The map overview exposes city centers and aggregate counts only. Clicking a city
opens its paginated founder list. Filtering and paging happen on the
server before rendering or serialization. The sitemap lists static pages only,
not a bulk list of profile URLs. Synthetic previews remain explicitly gated.

This removes convenient bulk extraction; it is not scrape prevention. Public HTML
and Next.js page responses remain readable by automated clients one page at a time.
No header checks, hidden endpoint names or robots.txt rules are treated as access
control. Strict scraping limits need edge-level request controls or authentication.
