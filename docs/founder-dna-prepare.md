# Prepare a Founder DNA source release

Use `scripts/founder-dna-prepare.ts` after the enrichment worker has saved founder
analyses and embeddings, and `scripts/enrichment.ts portrait` has saved checked
portraits. These commands read retained results. They do not accept display
profile JSON, collect new sources, approve portraits, or activate a release.

Run with Node 22 and the pinned pnpm. No environment files are loaded. Pass the
source database URL explicitly with `--database-url`; there is no database
environment fallback. The source database must already have the enrichment
migrations. Every command needs `--confirm-write`, including replay, because
replay can save decisions and stage edges.

## Approve portraits and prepare the cohort

Review each saved portrait, then approve its exact entity and portrait analysis
IDs with the existing command:

```sh
pnpm exec tsx scripts/enrichment.ts portrait-approve \
  --entity "$ENTITY_ID" --id "$PORTRAIT_ANALYSIS_ID" \
  --actor "$REVIEWER" --confirm-write
```

That enrichment command uses an explicitly set `ENRICHMENT_DATABASE_URL`. Keep
the following cohort manifest in a private file outside the repository. Replace
the illustrative UUIDs with approved retained IDs. A cohort contains 1–1000
distinct entities. Unknown fields, duplicate entities, and malformed IDs fail.

```json
{
  "version": 1,
  "releaseId": "pilot-001",
  "scope": "pilot-001",
  "profiles": [
    {
      "entityId": "00000000-0000-4000-8000-000000000001",
      "analysisId": "00000000-0000-4000-8000-000000000002",
      "portraitAnalysisId": "00000000-0000-4000-8000-000000000003"
    }
  ]
}
```

```sh
pnpm exec tsx scripts/founder-dna-prepare.ts prepare \
  --database-url "$SOURCE_DATABASE_URL" \
  --file "$PRIVATE_COHORT_FILE" --confirm-write
```

Preparation creates the source release and stages the stored approved profiles.
It preserves their analysis identities and creates no new approvals. The release
stays in `staging`, with no change to the active pointer. If a profile fails, the
earlier staged profiles remain private. Correct the eligibility problem and rerun
the same manifest to resume. A changed cohort needs a new release ID.

## Discover supported connections

Use an existing USD budget for the manifest scope. The total budget is created
separately by `scripts/enrichment.ts budget-create`. A Jev policy file must contain
`id`, the same `scope`, `operation: "typesafe-systemone"`,
`storageVerified: true`, and `retentionApproved: true`. Those policy declarations
must reflect an actual storage and retention review.

First lock the complete candidate set in a private batch manifest. The command
creates the file with owner-only permissions and refuses to replace an existing
file. Each full batch has exactly 25 ordered pair identities. The last batch can
contain fewer pairs.

```sh
pnpm exec tsx scripts/founder-dna-prepare.ts connections-plan \
  --database-url "$SOURCE_DATABASE_URL" --release pilot-001 --scope pilot-001 \
  --file "$PRIVATE_CONNECTION_BATCH_FILE" --confirm-write
```

Review the reported batch IDs. Run one named batch at a time:

```sh
pnpm exec tsx scripts/founder-dna-prepare.ts connections \
  --database-url "$SOURCE_DATABASE_URL" --release pilot-001 --scope pilot-001 \
  --policy "$PRIVATE_JEV_POLICY_FILE" --budget "$BUDGET_ID" \
  --jev-cap-micros "$PER_REQUEST_CAP" --max-requests "$REQUEST_LIMIT" \
  --batch-file "$PRIVATE_CONNECTION_BATCH_FILE" --batch "$BATCH_ID" \
  --mode acquire --allow-paid \
  --confirm-write
```

Paid acquisition requires an immutable batch file and one batch ID. The command
recomputes the complete candidate set and checks every request before the first
dispatch. A changed endpoint, source, analysis, embedding, pair order, manifest,
release, or scope fails closed. A repeated batch uses the same decision IDs and
retained responses, so it resumes without buying completed pairs again. Batch
runs save decisions but stage no edges because selection must compare the full
candidate set.

After all batches finish, run the command once with the same batch manifest and
without `--batch` or paid flags. This full replay checks the complete candidate
set again, ranks all retained decisions together, and stages at most three
accepted edges per profile:

```sh
pnpm exec tsx scripts/founder-dna-prepare.ts connections \
  --database-url "$SOURCE_DATABASE_URL" --release pilot-001 --scope pilot-001 \
  --policy "$PRIVATE_JEV_POLICY_FILE" --budget "$BUDGET_ID" \
  --jev-cap-micros "$PER_REQUEST_CAP" --max-requests "$REQUEST_LIMIT" \
  --batch-file "$PRIVATE_CONNECTION_BATCH_FILE" \
  --confirm-write
```

The default mode is `replay`. It uses retained responses and fails with
`missing_input` when a response is absent. It never dispatches a provider request,
even when credentials are present. Acquisition also requires explicitly set
`ENRICHMENT_ALLOW_PAID=1` and `TYPESAFE_AI_API_KEY`. The two existing key aliases
are also supported.

The release, policy, and budget scopes must match. `--max-requests` is a positive
integer no larger than 5000. It bounds the complete candidate set, including
cached decisions; an oversized set fails before dispatch. Each request reserves
`--jev-cap-micros` against the existing total budget. Provider token usage is an
estimate, not a settled receipt. Ambiguous calls are retained and are not retried
automatically; inspect and reconcile the attempt before any new paid work.

Candidates come from eligible staged profiles and compatible saved embeddings.
Each pair is checked again before and after its retained Jev decision. Accepted,
rejected, and insufficient decisions are stored. At most three accepted edges per
profile are staged. Missing or withdrawn endpoints produce no new edges. Empty
results are valid. The JSON result reports complete candidate, processed,
accepted, rejected, insufficient, and staged counts. No command activates the
release.

## Validate and export

Finish connection discovery before validation, which freezes further staging.
The separate `scripts/founder-dna-release.ts` bundle command handles validation,
export, destination dry-run/staging, activation, and rollback:

```sh
pnpm exec tsx scripts/founder-dna-release.ts validate \
  --database-url "$SOURCE_DATABASE_URL" --release pilot-001 --confirm-write
pnpm exec tsx scripts/founder-dna-release.ts export \
  --database-url "$SOURCE_DATABASE_URL" --release pilot-001 \
  --file "$PRIVATE_BUNDLE_FILE"
```

Keep the exported bundle private. Validate the destination separately after its
dry-run and staging operations. Activation and rollback remain explicit operator
actions, with the existing production approval requirement.

The offline regression in `tests/founder-dna-prepare.test.ts` runs these preparation
commands against PGlite with the real stores and a mocked Jev transport. It proves
approval gates, bounded requests, scope checks, retained capture, repeat replay,
and withdrawal without paid calls or an active release change.
