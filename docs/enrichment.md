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
      "provider": "weft/openrouter",
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
plus its matching policy, or use the offline worker option below. The endpoint must accept the configured model and
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

For `weft/openrouter` with the effective model `deepseek/deepseek-v4.1-flash`,
description, DNA and portrait recipes disable reasoning and require providers to
support the request parameters. This preserves the output budget for visible JSON.
Both controls are part of the saved recipe identity and captured request; previous
recipes keep their own identities. Other model settings and token caps are unchanged.

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

Personal DNA uses only evidence labeled `self-reported` or
`first-party-biography`. It excludes unknown, product-site and other source kinds;
product analysis can still use those sources. A supported `self_report` claim must
cite only self-reported evidence. A supported `publisher_statement` claim must cite
only a first-party biography or product site. Syntheses and deductions remain
`inference`. The exact selected evidence and selection version are retained in each
manifest. No eligible personal evidence leaves the DNA stage unavailable rather
than inventing personal traits. Descriptions are bounded to 1,800 output tokens; a
truncated response fails validation and is not published.

Product context retains cited evidence and other saved excerpts at the exact
product-page URL (ignoring fragments and trailing slashes). It does not retrieve
new pages or expand to every page on a domain. The selected evidence is retained
in the analysis manifest for comparison and replay.
When website collection is configured, the acquisition worker captures the
profile's public website with Exa or the free Jina Reader route.
Jina uses direct anonymous HTTPS, not the paid Weft gateway. Its zero-cost
attempt and bounded HTTP capture are still recorded by the same local ledger.
The client has a 60-second timeout, sends no credentials, does not follow outer
HTTP redirects, and does not retry. HTTP error bodies are retained within the same byte limit.
Atlas short URLs use an expanded URL only when exactly one saved URL entity matches the profile
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

## Offline embeddings on a worker host

The bounded worker can use local MiniLM inference instead of a paid embedding
endpoint. This is a CLI option; the web deployment does not provision a Python
worker or schedule enrichment.

On the intended worker host, install the versions in
[`scripts/local-embedding-requirements.txt`](../scripts/local-embedding-requirements.txt)
in an isolated Python environment. Supply the model's `onnx/model.onnx` and
`tokenizer.json` files from revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`
of `sentence-transformers/all-MiniLM-L6-v2`. The runner checks both file hashes
and all three inference library versions before inference. It never downloads
assets. Review the model license and source-input reuse policy before activation.
Keep model assets and the installed runtime outside Git.

Run `pnpm exec tsx scripts/enrichment.ts local-embedding-config` to print the
exact `configuration.embedding` value for this checkout. The vector identity
includes the runner digest; regenerate the release when that identity changes.
Set `transport.localEmbedding` to an object with absolute `pythonExecutable` and
`modelDirectory` paths. Add an approved `local-minilm-inference` policy under
`transport.policies`. Do not also configure `embeddingEndpoint`.

Inference uses an isolated Python process, a 30-second execution limit and a
1 MiB output limit. It inherits no account credentials. Inputs are truncated to
256 word pieces, with input and used counts recorded in the output. The saved
request includes the exact input text, template, model revision, file hashes,
runner digest and pooling settings. The complete successful process output is
stored before response validation. Process failures remain explicit unresolved
attempts; there is no automatic retry. Compatible saved outputs require neither
the model assets nor another process execution. Each local capture has a zero
price cap and records no charge; the worker's other stages retain their paid gates.

## Website response capacity

Direct Jina capture limits decoded response bytes to 2 MiB while reading the
stream. It does not trust `Content-Length`. At the first excess byte it cancels
the reader and stores only the bounded prefix with `capture.status=size_limit`,
the configured limit and observed byte count. This is an incomplete capture,
never usable source evidence. The stage reports `website_response_size_limit`;
replay preserves that outcome without a new request. Responses exactly at the
limit remain complete. Text excerpt limits are separate from this raw-byte limit.

This streaming limit applies to direct Jina only. Paid SDK responses arrive
buffered; their upstream size contract still needs review before enabling bulk
collection. An Exa policy must remain disabled without that proof and applicable
retention approval.

## Original indexing post display

After enrichment migrations and intake are verified in the directory database,
set server-only `ENRICHMENT_READ_ORIGINS=1` to make profile pages read the saved
indexing post. `FOUNDER_DNA_ENABLED=1` also enables these foundation visibility
checks. Legacy directory, map and profile reads use `DATABASE_URL`; the enrichment
schema and canonical suppression records must be in that same database. When DNA
is enabled, `FOUNDER_DNA_DATABASE_URL` is required and must identify the same host,
port and database as `DATABASE_URL`. Credentials and non-identity options such as
SSL settings can differ. Identity options (`host`, `hostaddr`, `port`, `database`,
`dbname`, `db`) in either URL query are rejected because drivers can override the
URL target. Unknown host aliases are not treated as equivalent. A mismatch fails before any
query and never switches to another URL automatically. This shared check also
runs before the DNA profile and share-image readers create either the Neon or
PostgreSQL client. A missing
schema or failed eligibility query fails the read; it never retries without the
filter. With both flags off, existing directory behavior is unchanged.
An imported origin keeps its original text and URL even if the founder row later
changes. Unknown, expired, withdrawn or purged origins show no tweet; suppressed
entities return no profile. Unimported rows retain their existing display.

The flag does not collect a new tweet or establish historical certainty for a
legacy snapshot. Suppressed founders are excluded in SQL from the map, directory
rows, total, categories, country and city counts, and city-to-country inference.
Filtering happens before pagination. Unimported legacy rows remain visible.
Verify broader deletion and backup replay separately before production rollout.

The migration command also supports an empty database. It applies the core
schema and skips legacy intake when `public.founders` is absent. Run it again
after adding the legacy founder table to install that optional intake trigger.

## Checked Founder DNA portraits

The portrait driver uses saved evidence and the existing generation transport.
It does not collect sources or require a product. Before a run, add
`founder_portrait: stableDigest(founderPortraitRecipe(model, codeDigest))` to the
execution release's `recipes`, save its evaluation, approve the release and
promote the target generation through the normal release workflow.

Run `scripts/enrichment.ts portrait` with `--file INPUT.json`, `--policy` for
text generation, `--jev-policy` for `typesafe-systemone`, a shared `--budget`,
`--max-cost` in USD for generation, and `--jev-cap-micros` for direct Jev. The
input contains `entityId`, the eligible `founderAnalysisId`, `releaseId`, target
`generation`, one to six retained `evidenceIds`, `model` (provider/model/revision),
and `codeDigest`. Both policies must use the same scope. Inputs, policies and
provider responses are private operator data, never public profile JSON.

This command requires `--confirm-write`, `--allow-paid`,
`ENRICHMENT_ALLOW_PAID=1`, `WEFT_API_KEY`, and `TYPESAFE_AI_API_KEY`
(`TYPESAGE_AI_API_KEY` and `TYPESAFE_API_KEY` are supported aliases). No environment
file is loaded. It uses only explicit `ENRICHMENT_DATABASE_URL`. Each new portrait
uses at most one text-generation call. Judge v6 groups fact checks by exact source
subset and prose checks by exact cited fact subset, then classifies facets in a
separate call. A typical profile uses three Jev calls; the maximum is fifteen.
All request sizes and the planned count are checked before the first judge call.
A failed fact group stops before prose; a failed prose group stops later groups.
An operator must also enforce its approved aggregate call limit. Repeating the same completed
run reuses its saved analysis. Replay identity includes the eligible published
product analyses and their evidence/relationship references, so a changed product
publication creates a new portrait run. Product claims remain display inputs and
are not supplied as personal evidence to the generator or judge. Failed or uncertain dispatches have no automatic
retry. An approved aggregate budget bounds the full run; per-call caps do not
replace that budget.

Generation and judgment have separate version identities. Generation v5 asks for
useful atomic facts, exact role/ownership attribution and concrete editorial humor;
it does not force coverage of every source. Its schema separates local fact IDs
(`f1` through `f8`) from source evidence IDs. Portrait and roast references must
name facts actually present; source references remain on those facts. It requires
a new approved generation recipe and cannot reuse earlier generation captures as
if their prompt were unchanged.
Judge v6 remains separate. It evaluates factual grounding and a distinct
trait-safety question inside each existing prose request, so unsupported personality,
motivation, preference, tolerance, ability, habit or repeated-behavior claims fail
without adding a provider call. When the generation recipe and inputs are unchanged,
a new judge version can keep the original generation run ID while creating a new
analysis/check ID. To resume checking a retained generation, call the same driver
with its original input, generation `codeDigest`, approved recipe manifest and
transport scope/policy/provider/price cap. The generation adapter reuses that
retained response before any dispatch. Record the current runtime/checker version
separately. A generation prompt, model, source or recipe change requires new
generation provenance; never carry an old digest across such a change.

Direct Jev requests are bounded to 40,000 serialized UTF-8 bytes and reserve the
full per-call cap. Each provider request physically contains only the relevant
source subset; a prose request also contains only its cited facts. Other sources
cannot influence the scoped judgment. Evidence and common rules appear once per
request. Numeric references preserve exact citation scopes. The private report's
`judgeExchanges` retains every request/response ID, scope, question keys, evidence
IDs and usage estimate, including completed exchanges before a failed check.
All v5 exchanges must remain retained for a profile to stay visible. A source-only size check runs before any
generation. The complete generated request is checked again before judging; if it
does not fit, the failure report retains its byte count and no judge call occurs.
No evidence is truncated. Arbitrarily long or multibyte inputs are not guaranteed
to fit merely because their individual fields pass the public parser.
Token usage at $0.042 per million input tokens is an estimate, not a settled
payment receipt. Estimated usage above the cap stops the run after retaining the
response. Fact checks require `supported`, confidence at least 0.8 and support
probability at least 0.8. Each fact is checked only against its own cited source
subset; other sources cannot rescue an unsupported citation. Prose requires `grounded` at the same thresholds. This single positive verdict
covers both supported factual prose and clearly figurative editorial humor that
adds no factual claim; unsupported traits remain unacceptable. Each roast
line is bound to its own fact citations; other displayed prose is bound to the
portrait's fact citations. The private request and validation report retain the
clause-to-fact-to-source mapping. Uncited facts or sources cannot support a clause. Every check
and its probabilities remain in the private validation report. Failed checks do
not replace a published portrait. Infrastructure failures save a private interruption
manifest with completed exchange provenance, then stop without a terminal analysis.
An explicit resume can reuse those captures after reconciliation; uncertain
attempts remain blocked and are never automatically retried. Source withdrawal
also purges the interruption record and its derived captures. A website capture
whose metadata links `sourceProfileArtifactId` to a withdrawn artifact is part of
that closure, including its evidence and analyses that cite the capture. Worker
source-bundle and extraction manifests are in the same closure. New manifests
record `sourceArtifactIds`. Manifests written before that field are included when
their known `profile-website-bundle-v1` or `profile-website-evidence-v1` body cites
a withdrawn artifact. Withdrawal clears those bodies, so a website URL retained
only in a worker manifest cannot stay readable.

Portrait approval is separate from the foundation's existing profile publication:
`portrait-approve --entity UUID --id PORTRAIT_ANALYSIS_UUID --actor NAME
--confirm-write`. It approves a saved successful portrait for staging only. The
`DnaPublicationStore` stages profiles from retained analysis output, validates
counts, source eligibility and hashes, then activates one data-release pointer
atomically. Activation also proves that the release currently covers every public
directory founder and every founder linked from a published product. See
[Founder DNA data releases](founder-dna-releases.md). The proof does not collect
missing profiles or hide founders. It never accepts an operator-authored display profile. Connections
are separate accepted retained decisions and disappear if either endpoint becomes
ineligible. Rollback revalidates the prior data release and that same coverage
proof before restoring its pointer.

The web reader is off unless `FOUNDER_DNA_ENABLED=1`. It requires
`FOUNDER_DNA_DATABASE_URL`; it never falls back to `DATABASE_URL`. Use
`FOUNDER_DNA_DATABASE_TRANSPORT=postgres` for an explicitly selected local PostgreSQL
instance; the default transport is Neon. Missing configuration or reader errors
return `unavailable`. Hidden and not-found outcomes remain distinct from disabled.
Only sanitized public fields cross the reader boundary; raw responses, prompts,
cost data and evaluations remain private. Expired, withdrawn or purged evidence,
withdrawn model captures, suppression and stale analysis references fail closed.
