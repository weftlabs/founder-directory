# Private Founder DNA data releases

Compute portraits and connection decisions in the enrichment worker. Serve only
saved, approved releases. Profile and image requests must never call a provider.
Code deployment and data activation are separate operations.

`lib/enrichment/dna-bundle.ts` exports one release and its retained dependencies:
source bytes, evidence and owner links, approved analyses, approval artifacts,
product ownership references, portrait approvals and published edge decisions.
For v5 portrait judgments, every scoped judge request and response is required.
The singular compatibility IDs do not replace the full exchange list. Earlier
v3/v4 judgments retain their singular captures.
It does not export the whole database, worker queue, active pointer or suppression
state. Bundles are private. Never commit them, publish them, or place them in
`public/`. The export command creates a new file with mode `0600` and will not
overwrite an existing file.

Run the commands with the pinned Node and pnpm versions. The schema must already
be migrated using the enrichment migration runner. This command does not load an
environment file, infer a database, run migrations or make paid requests.

```sh
pnpm exec tsx scripts/founder-dna-release.ts export \
  --database-url "$SOURCE_DATABASE_URL" --release RELEASE_ID --file private-bundle.json
pnpm exec tsx scripts/founder-dna-release.ts dry-run \
  --database-url "$DESTINATION_DATABASE_URL" --file private-bundle.json
pnpm exec tsx scripts/founder-dna-release.ts stage \
  --database-url "$DESTINATION_DATABASE_URL" --file private-bundle.json --confirm-write
pnpm exec tsx scripts/founder-dna-release.ts validate \
  --database-url "$DESTINATION_DATABASE_URL" --release RELEASE_ID --confirm-write
pnpm exec tsx scripts/founder-dna-release.ts activate \
  --database-url "$DESTINATION_DATABASE_URL" --release RELEASE_ID --confirm-write
pnpm exec tsx scripts/founder-dna-release.ts rollback \
  --database-url "$DESTINATION_DATABASE_URL" --confirm-write
```

Use a private operator terminal. A URL passed as an argument can be visible to
other local processes. Never paste credentials into a ticket, log or screenshot.
`--confirm-write` is a command guard; it does not replace production authorization.

Dry-run checks versions, hashes, dependency coverage, canonical identity conflicts,
retention and destination state without writes. Stage is one atomic transaction;
an interrupted stage leaves no partial data. Repeating the same bundle is safe.
Stage does not activate it. Validate and activate recheck eligibility. Failed
upload, validation or activation leaves the previous active release selected.
Rollback rechecks the previous release; it cannot restore withdrawn material.

Existing founder identities match on kind and normalized handle. Conflicting known
source author IDs block a match, including a reassigned handle. Missing source IDs
are reported as unverified handle matches in the dry-run summary. Stage rejects
an unverified match when the source and destination entity IDs differ. Retain
matching source author ID evidence before retrying; a matching handle alone does
not prove identity. Same-ID replay remains safe. Product identity
uses the established owner-and-product-name key. The importer retains the source
identity map and original artifact origins in a private provenance artifact.
Captured bytes and metadata remain unchanged. Conflicting identities, suppressed
entities, purged or withdrawn artifacts, changed immutable rows, retired source
releases and newer published analyses block import. Resolve a conflict in the
source pipeline or destination policy; do not delete records to bypass it.
Legacy founder rows and publication pointers are never replaced by a local dump.

The manifest records cohort, row counts, code/schema compatibility, content hashes
and the selected artifacts' collection ledger totals. Settled cost and unresolved
reserved caps are separate. Caps are not spend. Estimates retained in analysis
validation reports remain estimates; local compute and missing provider invoices
need separate accounting. Re-export retains import provenance and original cohort
cost totals. A partial imported cohort without a matching cost manifest reports
`unpricedImportedArtifacts`; zero settled cost is not a zero-cost claim. Bundle
hashes detect corruption, not authenticity:
transfer only an independently reviewed archive through private storage.

Verification: `pnpm exec tsx --import ./tests/no-network.mjs --test
 tests/founder-dna-bundle.test.ts` rehearses export, dry-run, repeated/interrupted
stage, identity mapping, corruption, suppression, activation and withdrawal-aware
rollback in isolated PGlite databases. Production release additionally needs the
normal code review, current revision checks and explicit maintainer authorization.
