# Product analytics

Founder Directory uses optional client-side PostHog analytics. Analytics stays
off when `NEXT_PUBLIC_POSTHOG_KEY` is blank or does not start with `phc_`.
When enabled, analytics records site-wide page events and a small allowlist of
custom events. Analytics must never stop a page action or navigation.

## Questions

Product events answer these questions:

1. How often does a ready profile lead to a successful share-text copy or an
   image download start?
2. How often does a visitor reach the connection section, preview a connection,
   and click a connected profile?
3. Does the graph or card surface produce more connection clicks?
4. Which release and profile revision produced the behavior?
5. How often does a page with the site header start the live-presence heartbeat?

The app sends one profile event per ready page mount, zero or one connection
section event per mount, and one event for each deliberate action. The app does
not have an active-visitor baseline. A deployment owner must use the current
pageview volume to forecast event cost before enabling analytics.

## Event contract

Every custom event uses `schema_version: 1`. The schema version belongs to the
analytics contract. It is independent of the Founder DNA data schema version.

The site header emits `weft_founder_directory_presence_started` once when its
live-presence component mounts and starts the heartbeat. It has no event-specific
properties. It does not prove that another founder was found or contacted.

| Event                                     | Additional properties                                |
| ----------------------------------------- | ---------------------------------------------------- |
| `weft_founder_dna_profile_viewed`         | none                                                 |
| `weft_founder_dna_share_copied`           | none                                                 |
| `weft_founder_dna_image_download_started` | none                                                 |
| `weft_founder_dna_connections_viewed`     | `connection_count`                                   |
| `weft_founder_dna_connection_previewed`   | `connection_id`                                      |
| `weft_founder_dna_connection_clicked`     | `connection_id`, `destination_profile_id`, `surface` |

All six Founder DNA events also contain `profile_id`, `profile_revision`, and
`release_id`. These values, revisions, and connection IDs are bounded opaque
internal identifiers. `connection_count` is an integer from 1 through 3. `surface`
is `graph` or `card`.

Custom events do not send handles, names, locations, URLs, referrers, copied
drafts, portrait text, source text, or person properties. PostHog assigns an
anonymous browser ID. Each event also retains the configured public PostHog
project token because ingestion requires it. The privacy filter rejects a
different or missing token. The app does not identify a visitor. Autocapture
and session recording are off, and analytics persistence is in memory.

The root layout sends `$pageview` and `$pageleave` across the site. Their property
maps contain the public project token, anonymous browser ID, and a sanitized
current URL only. The sanitizer removes credentials, query strings, and
fragments. For the canonical
`/u/<handle>` profile route, it replaces the path with `/u/:handle`. It keeps the
exact path for other routes. It drops page events with an invalid HTTP or HTTPS
URL. It does not retain a referrer or any other PostHog-supplied property.

The event facts have narrow meanings:

- `profile_viewed` means that the ready profile client component mounted.
- `share_copied` means that the Clipboard API reported success.
- `image_download_started` means that the visitor clicked the download link. It
  does not prove that the response completed.
- `connections_viewed` means that at least 20 percent of the connection section
  entered the viewport.
- `connection_previewed` means that the visitor selected a graph node.
- `connection_clicked` means that the visitor clicked a graph or card link. It
  does not prove that the destination loaded.

## Offline verification

`tests/analytics.test.ts` checks the exact catalog, property types, allowlists,
and PostHog privacy filter. `tests/e2e/founder-dna-analytics.spec.ts` uses the
fictional `/founder-dna-preview` route and a browser-side PostHog stub. It checks
the real UI interactions without a PostHog token, database, or network request.
The route returns 404 unless `DIRECTORY_PREVIEW=1`.

These tests prove the client payload and UI binding. They do not prove that
PostHog stored an event.

## Live readback

After a deployment, record a UTC start time. Open one ready profile, reach the
connection section, preview and click one connection, copy the share text, and
start one image download. Read the six Founder DNA events, the profile page
events, and the site-header presence event back from the dedicated PostHog
project. Check the event names, property types, anonymous browser ID, and full
custom-event property maps. Confirm that no old event name, profile handle,
query string, fragment, referrer, copied text, or `$identify` event appears after
the recorded time. Confirm that profile page events use `/u/:handle` and that
page events for other routes keep only the expected origin and path.

The public `NEXT_PUBLIC_POSTHOG_KEY` permits ingestion. It cannot read events.
API readback needs the numeric PostHog project ID and a personal API key with
project query access. Keep that key outside this repository and never expose it
through a `NEXT_PUBLIC_*` variable. An authenticated PostHog UI session can be
used for manual readback. Browser network inspection proves only that a request
left the browser; it is not storage evidence.
