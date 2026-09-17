# Enrichment operations

Enrichment keeps source responses separate from extracted evidence and generated
results. Public pages must use eligible published results, not raw artifacts.
The existing directory layout is unchanged.

## Safety and rollout

Paid profile, intro search and place calls use durable capture. A buyer key alone
does not enable them. Configure the archive, reviewed source policies and budget
first. Missing configuration stops collection; there is no unarchived fallback.

Do not set these values in a public environment variable:

- `ENRICHMENT_DATABASE_URL`: explicit PostgreSQL connection. It never falls back
  to the directory's `DATABASE_URL`.
- `ENRICHMENT_ALLOW_PAID`: `1` enables the configured paid boundary. Set `0` to
  stop subsequent paid dispatches. Already dispatched requests remain uncertain
  until captured or reconciled.
- `ENRICHMENT_CAPTURE_CONFIG`: JSON with `scope`, `budgetId`, integer
  `generation`, and `policies` keyed by operation ID. Each policy records `id`,
  matching `scope`/`operation`, `storageVerified` and `retentionApproved`.

The policy booleans record operator preflight; they do not prove provider terms.
Before enabling an operation, verify its storage/model-use permissions, maximum
response size, retention, payment semantics and restore requirements. This slice
uses private PostgreSQL bytes. Do not enable an adapter whose bounded responses
do not fit that backend. No paid pilot or production migration is part of CI.

Use the same database as the directory if you want the intake trigger to track
new `founders` rows. The trigger must exist before new intake is considered
covered. Keep privileges server-only and use a separate read role for serving.

## Operator commands

Run `pnpm exec tsx scripts/enrichment.ts --help` for the command list. The tool
does not load `.env` files. Supply the explicit environment yourself. Mutations
require `--confirm-write`; model calls additionally require `--allow-paid`.

1. Back up the target database and test a restore. Measure response sizes and
   expected retained source/analysis bytes.
2. Run `migrate --confirm-write`. Additive migrations create the enrichment
   records and, when `founders` exists, seed a durable legacy intake queue and
   install a no-spend trigger for future inserts. Existing origins are marked
   `legacy-unverified`; migration does not invent original API responses.
3. Prepare a worker configuration as described below. Run `release-template
--file WORKER_CONFIG.json` and save its JSON output as `MANIFEST.json`. This
   command needs no database and makes no paid calls. It calculates the exact
   recipe digests and stage dependencies; do not hand-edit those digests. Create
   the candidate with `release-create --file MANIFEST.json --confirm-write`.
4. Evaluate the candidate on permitted, saved evidence. Import the review record
   with `evaluation-import --file EVALUATION.json --batch NAME --confirm-write`.
   This returns an artifact UUID, not an approval. Pass that UUID to
   `release-approve --id RELEASE_UUID --evaluation ARTIFACT_UUID --actor NAME
--reason TEXT --confirm-write`, then use `release-promote --scope NAME
--id RELEASE_UUID --reason TEXT --confirm-write`. Promotion records a
   monotonic intake revision. No release is automatically approved.
5. Run `intake --scope NAME --limit 100 --confirm-write` repeatedly. This resumes
   pending legacy/new rows and expands durable targets into stage work. An absent
   approved intake release leaves the transaction incomplete, not falsely done.
6. Use `inventory` to inspect counts, bytes and stage coverage without printing
   private profile payloads.

An evaluation file is an operator-authored JSON object with `rubricVersion`,
`reviewer`, a nonempty `caseResults` array, and boolean `passed`. Include the
fixed input IDs, baseline/candidate outputs, unsupported-claim findings, coverage,
cost and preset pass criteria in that record. Import validates its shape, not
the quality of the review. Do not put credentials in the file. Approval remains
a separate operator decision.

`budget-create --scope NAME --cap-micros INTEGER --confirm-write` creates an
aggregate USD budget. One micro-dollar is one millionth of a dollar. The ledger
counts settled spend and unresolved reservations once. Capturing a provider cap
breach preserves the body and records the actual overage; it blocks further
budget use instead of discarding evidence.

## Run the full worker

The `worker` and `analyze` commands allow up to 150 seconds per Weft exchange,
including model generation and payment overhead. Ordinary directory scans retain
their 25-second limit. Timeout cancellation does not prove payment cancellation:
the attempt stays uncertain and is never automatically retried. Upstream caller
cancellation remains effective even when the longer worker timeout is selected.

The worker configuration has two parts. `configuration` determines the approved
analysis and embedding versions. `transport` selects the reviewed paid operations
and an existing aggregate budget. Keep this file private and outside Git.

This example is a **template**, not a working or authorized provider setup.
Replace every `REVIEWED_...` value and `BUDGET_UUID` with verified values:

```json
{
  "configuration": {
    "codeDigest": "REVIEWED_BUILD_DIGEST",
    "model": {
      "provider": "openrouter",
      "model": "REVIEWED_MODEL_ID",
      "revision": null
    }
  },
  "transport": {
    "scope": "directory",
    "budgetId": "BUDGET_UUID",
    "generation": 0,
    "sourceMaxCostUsd": "0.01",
    "modelMaxCostUsd": "0.01",
    "policies": {
      "bazaar-x402-atlas-183": {
        "id": "REVIEWED_SOURCE_POLICY",
        "scope": "directory",
        "operation": "bazaar-x402-atlas-183",
        "storageVerified": false,
        "retentionApproved": false
      },
      "openrouter-chat-completions": {
        "id": "REVIEWED_MODEL_POLICY",
        "scope": "directory",
        "operation": "openrouter-chat-completions",
        "storageVerified": false,
        "retentionApproved": false
      }
    }
  }
}
```

The sample policies deliberately prevent dispatch. Change their values only
after the relevant checks. A null model revision records an unresolved alias;
it does not promise an immutable upstream model. Per-request caps do not replace
the aggregate budget.

For vectors, add `configuration.embedding` with `model`, `modelVersion` and
`dimensions`. Also add `transport.embeddingEndpoint` with the reviewed `url`,
`operationId`, `accessMethodId`, `maxCostUsd` and boolean `includeDimensions`,
plus its matching policy. The endpoint must accept the configured model and
input text and return `data[0].embedding`. No embedding endpoint is guessed.
Without this configuration, the vector stage is blocked, not falsely complete.
Regenerate and approve a new release manifest after changing configuration.

With explicit private environment variables set, run:

```sh
pnpm exec tsx scripts/enrichment.ts worker \
  --file WORKER_CONFIG.json --scope directory --mode acquire \
  --limit 25 --lease-seconds 900 --allow-paid --confirm-write
```

This imports at most 25 pending founders, reconciles durable targets, then claims
at most 25 **stages**, not 25 complete profiles. Claims are restricted to the
configured scope. Repeat bounded runs to process a larger directory. Existing
and newly indexed founders use the same path. Worker calls require all three:
`--allow-paid`, `ENRICHMENT_ALLOW_PAID=1`, and `WEFT_API_KEY`.

Use `--mode rederive` to reuse saved sources without source-network access.
Missing source bytes produce a blocked stage. Model and embedding calls can
still cost money and use the same explicit gates and budget. Already successful
compatible analyses and vectors are reused. The worker checks its lease before
each paid callback; expired, superseded or suppressed work cannot start another
call. Existing ambiguous attempts still need reconciliation, not blind retries.

Restarting a worker resumes **pending** work. It does not reclaim every crashed
stage. After a worker dies, an operator can call `EnrichmentStore.recoverExpiredLeases()`
to mark expired running stages blocked. Inspect the saved attempt and result,
reconcile any uncertain payment, then authorize the appropriate recovery. This
slice has no general automatic requeue or CLI command for that decision.

The stages preserve raw profiles, extract evidence, discover cited products,
write separate product descriptions and founder DNA, then create configured
vectors. Unknown product ownership leaves product coverage partial but does not
prevent independent founder DNA from available evidence. A protected account is
unavailable. Only explicit evidence of no products permits a not-applicable
description step. Published available fields do not mean all stages are complete.

## Analysis and replay

`analyze --file INPUT.json --policy POLICY.json --budget UUID --max-cost USD
--allow-paid --confirm-write` executes an analysis of already saved evidence.
The input contract is exported by [contracts](../lib/enrichment/contracts.ts);
[recipes](../lib/enrichment/recipes.ts) builds evidence-only description and DNA
inputs. The database validates source ownership, retained bytes and the active
target before cache access or model dispatch. Current templates cannot silently
replace saved inputs. Unsupported external context/tool execution is rejected.

Every result keeps its exact manifest, rendered messages, model settings, raw
response, validation outcome and payment attempt. Invalid outputs remain private.
An unchanged successful input reuses its result; a changed recipe creates a new
derived result without source recollection. Model calls can still cost money.
Saving a request does not guarantee identical output from a later model call.

The description recipes distinguish explicit founder statements, product-site
statements and inferences. Product capabilities are not personal skills or work
habits. Planned releases and offers remain labeled as plans. Missing evidence
stays unknown; JSON validation alone does not prove factual accuracy. Review
candidate claims against the saved sources before approving a release.

Evidence inputs can carry the source kind and observation time stored with their
artifact. These labels are descriptive, not a verification of the claims. Supplied
labels must match saved metadata before reuse or dispatch. Older manifests without
these optional labels remain unchanged on replay. Observation time is not a
publication date or proof that an announced event happened.

Personal DNA excludes evidence explicitly labeled `product-site`; product analysis
still uses it. Unknown source labels remain eligible, so this rule does not prove
complete source classification. The exact selected evidence and selection version
are retained in each manifest. No eligible personal evidence leaves the DNA stage
unavailable rather than inventing personal traits. Descriptions are bounded to
1,800 output tokens; a truncated response fails validation and is not published.

Product context retains cited evidence and other saved excerpts at the exact
product-page URL (ignoring fragments and trailing slashes). It does not retrieve
new pages or expand to every page on a domain. The selected evidence is retained
in the analysis manifest for comparison and replay.
When website collection is configured, the acquisition worker captures the
profile's public website with Exa or the free Jina Reader route. Atlas short URLs
use an expanded URL only when exactly one saved URL entity matches the profile
website URL. Unsafe or duplicate matches yield no website. Unrelated bio links
are not used. Full provider responses are saved before source-text extraction;
the source bundle records the provider for later replay without a new purchase.
Product-page evidence can support product descriptions, not personal DNA.
Changing the profile extractor requires an approved new release; saved profile
responses can be parsed again without buying another profile response.

`publish --id ANALYSIS_UUID --confirm-write` updates the projection only when
the release, evidence generation and current intake revision permit it. Failed
or stale candidates do not overwrite the last eligible result. Publication is
separate from full stage completion.

Embeddings retain their exact input text and compatible model/template space.
They are derived data, not a replacement for descriptions or evidence. Unknown
product facts and unavailable sources must remain visible as partial coverage.

## Verification and limits

Offline tests run actual PostgreSQL semantics through PGlite with synthetic data.
They cover request exclusion, budget limits, archive/replay, restore checks,
1,001-member campaigns, arrivals, original posts and publication gates. They do
not prove a production PostgreSQL deployment, provider idempotency, maximum
response size or source permissions.

An external response can be lost if the process dies before persistence and
the provider offers no retrieval. Such attempts stay uncertain; never repeat
the purchase merely because no local body exists. Backup retention and deletion
replay need an operator-tested policy before production activation.
