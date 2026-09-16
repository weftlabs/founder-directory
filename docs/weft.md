# How Weft powers Founder Directory

Visitors use application functions, not a generic API console. Weft stays under
the server boundary: one buyer credential connects the app to external data and
location normalization. There is no Vercel AI Gateway or browser-side buyer key.

| Function          | Capability                   | Source owner                | Request cap |
| ----------------- | ---------------------------- | --------------------------- | ----------- |
| Search intros     | Atlas X search               | [x.ts](../lib/x.ts)         | $0.01       |
| Hydrate a profile | Atlas X user details         | [x.ts](../lib/x.ts)         | $0.01       |
| Normalize places  | OpenRouter chat through Weft | [place.ts](../lib/place.ts) | $0.002      |

These are ceilings, not quoted prices or a promise of successful delivery. Prices
and availability can change; check the live Weft catalog before changing an
operation. IDs and endpoint contracts belong to the source adapters, not a
second hard-coded list in documentation.

## Failure and payment semantics

The [retry helper](../lib/weft-retry.ts) bounds eligible retries to three attempts
with backoff and unchanged per-request caps. It reuses the logical request key;
this is not a durable one-charge guarantee. Known payment holds or charges must
not be replayed. Policy/auth/budget refusals and ambiguous transport failures stop.
An HTTP 200 with a pending receipt can be usable data with settlement unfinished.

A cap limits one request, not the whole scan. Every new intro found is
imported; a tick may persist leftover handles and finish them on the next
run so Vercel’s 300s limit cannot drop people. The scheduled scan spends at
most eight search requests and 15 profile hydrations (bulk: 16 and 30),
stops before ~240s, and resumes each phrase from a stored cursor instead of
restarting at latest page 1. Retweet-only pages do not stop pagination.
Per-request Weft caps are unchanged. Budget for every eligible attempt and
account for both paid and held funds. Never raise limits automatically after
a refusal. The Weft account policy is the final wallet-level spending control.

Atlas search results contain public intro posts. If a paid profile request has
an HTTP 502 or 504 response, store a basic row from that public intro before the
scan continues. Do not replay that paid request. Other profile failures still
skip the row, including a successful profile response that identifies a
protected account. Basic rows require a separate future enrichment operation.
During a confirmed profile-provider outage, the operator can materialize already
queued public intros without sending another paid profile request. It skips and
reports any legacy queue item that has no valid source tweet ID.

Do not surface provider exceptions verbatim in the public app. Store only the
profile fields needed by the product; do not expose keys, payment headers or raw
provider dumps. Record sanitized status and receipt identifiers for diagnosis.

## Limits of the example

The location model is not a geographic authority. Null is safer than invented
chips; defensive cleanup is not a complete gazetteer. The founder signal score
is a transparent heuristic, not identity verification, reputation or a judgment
of a person's worth. The directory does not message people or automate outreach.
