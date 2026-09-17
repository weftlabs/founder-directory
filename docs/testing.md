# Testing and CI

## Fast feedback

Use Node 22 and the pinned pnpm. Install with `pnpm install --frozen-lockfile`.
For an inner loop, run a single file: `pnpm exec tsx --test tests/weft-retry.test.ts`.
Tests use `node:test`, synthetic fixtures, and stubbed provider calls. Never copy
production profiles or receipts into fixtures.

The broad local gate is:

```sh
pnpm exec playwright install chromium
pnpm verify
```

`pnpm verify` runs format checks, ESLint, TypeScript, unit tests, repository and
build-trace checks, then both browser suites. Playwright starts the production server on port 3100 with blank database,
Weft and cron credentials. It refuses to reuse an existing server. Its desktop
and mobile tests exercise branding, empty-state search, chip controls, missing
profiles and unauthorized cron requests. These smoke tests do **not** prove a
funded provider or populated Neon path.

## Regression standard

For a bug, demonstrate a failing assertion before changing the implementation.
Cover success and failure outcomes: missing credentials, malformed payloads,
partial results, exhausted retries, policy refusals, and held/paid receipts.
Never hide a failing assertion behind a catch, arbitrary sleep or disabled test.
Use fake delays for retry-policy tests; do not pay for retry coverage.

## CI contract

[CI](../.github/workflows/ci.yml) runs for pull requests and pushes to `main` on
GitHub-hosted Linux, Node 22, and a frozen lockfile. Actions are pinned by SHA;
the token is read-only and checkout does not retain credentials. Fork PRs receive
no deployment or provider secrets. No `pull_request_target` execution of fork code.
Failure traces are retained briefly for debugging; only synthetic/no-key tests
may produce them. Dependabot proposes updates; a maintainer still reviews them.

CI on the exact PR head is the merge signal. Branch-protection requirements are
GitHub settings, not something this YAML enables by itself. Maintainers should
require the quality check and review before merge.

Vercel Git creates a preview for every non-`main` branch push.
[CD](../.github/workflows/cd.yml) is separate: a push to `main` deploys another
Vercel preview; a `vX.Y.Z` tag deploys production. CD needs `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. See [deployment](deployment.md).

## Separate paid verification

A real Weft probe is an operator action, never a PR gate. Establish a total
budget, inspect the wallet policy, call the smallest request, preserve sanitized
status/receipt identifiers, and account for paid plus held amounts. An ambiguous
timeout can still have charged. Do not retry it blindly. Read back exact rows
after any explicitly approved database write.
