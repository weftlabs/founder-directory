# Deploying

Non-`main` branches use Vercel Git auto-deploy for temporary previews.
[CD](../.github/workflows/cd.yml) starts only after CI succeeds on `main`. It
builds one production artifact, deploys it without assigning the production
domain, and records its immutable deployment URL in a GitHub Actions artifact.
A semver tag at that exact current `main` SHA promotes the recorded deployment.
The tag path never rebuilds it.

| Event                  | Deployment                     |
| ---------------------- | ------------------------------ |
| Non-`main` branch push | Vercel **preview** via Git     |
| Green CI on `main`     | Vercel staged production build |
| Semver tag (`vX.Y.Z`)  | Promote that exact deployment  |

CI still gates merge. A green check creates a protected candidate URL; it does
not change the production domain. Production is the tagged commit only.

## Maintainer setup

1. Create a Vercel access token and read `orgId` / `projectId` from
   `.vercel/project.json` after `vercel link` (do not commit that folder).
2. Set repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and
   `VERCEL_PROJECT_ID`. CD exposes them only to the Vercel steps that need them.
3. In Vercel Project Settings, open Environment Variables and enable
   **Automatically expose System Environment Variables**. The runtime release
   proof requires Vercel to supply `VERCEL=1`, `VERCEL_DEPLOYMENT_ID`, and
   `VERCEL_PROJECT_PRODUCTION_URL`. Do not define or copy these values manually.
   Candidate verification fails if the deployment ID is unavailable.
4. Keep production env vars (`DATABASE_URL`, `WEFT_API_KEY`, `CRON_SECRET`) on
   the Vercel production environment. Use a different Neon branch and wallet
   limits for preview. Never put those values in GitHub Actions as
   `NEXT_PUBLIC_*` or in this repo. Optional product analytics: a public
   PostHog project token as `NEXT_PUBLIC_POSTHOG_KEY` (must start with `phc_`)
   and `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`. Create a dedicated
   Founders Directory project. Do not reuse another app's token. The online-now
   chip counts Neon heartbeats, not PostHog.
5. Keep `main` excluded from Git auto-deploy. `vercel.json` enables automatic
   previews for other branches but sets `git.deploymentEnabled.main` to
   `false`, so a merge cannot also promote production.
6. Protect generated candidate URLs with Vercel Deployment Protection. The
   candidate smoke uses `vercel curl`, which can read a protected deployment.
7. Configure the GitHub `production` environment with Patrick as required
   reviewer. Review the tag, full SHA, CI run, candidate run, artifact digest
   and staged URL in the `Verify tag candidate` summary before approval. The
   `production-candidate` environment records staged URLs and has no production
   approval gate.

After green `main` CI, wait for `Stage production candidate` to finish. It
retains `production-candidate-<full-sha>` for 90 days. Then release:

```sh
git fetch origin main --tags
approved_sha=$(git rev-parse origin/main)
git tag v0.5.0 "$approved_sha"
git push origin v0.5.0
```

The tag workflow requires strict `vX.Y.Z`, the current `origin/main` SHA, the
exact successful CI run and one unexpired candidate record for that SHA. It
rechecks Vercel's project, production target, ready state, deployment metadata
and `/api/release` readback. After the protected-environment approval, it runs
`vercel promote` on the recorded URL and requires the production domain to read
back the same SHA and resolve through Vercel to the same deployment ID. Vercel
promotion of a staged production deployment assigns domains without a rebuild.
Cron in `vercel.json` continues to target the current production deployment.

The public `/api/release` response contains exactly `sha` and `deployment_id`.
The SHA is embedded at build time. The deployment ID is the automatic Vercel
system value for that deployed artifact. The response contains no other
environment configuration, data-release identity, or profile state. A missing
or malformed value returns 503.

## Cron release guard

The discover and hydrate cron routes compare their local `sha` and
`deployment_id` with `/api/release` on `VERCEL_PROJECT_PRODUCTION_URL` before
they start a scan. On Vercel, a missing or invalid value, a failed production
read, a timeout, or either mismatch returns `503 Inactive release`. Therefore a
staged deployment and an old deployment cannot run paid collection after a new
deployment becomes current.

This fail-closed behavior requires the automatic Vercel system variables from
the setup section. Local development does not set `VERCEL=1` and skips this
production comparison. Cron authentication and the scan budget controls still
apply. The guard does not stop a request that was already running.

## Rollback

Use this sequence for a code rollback:

1. Select a previously verified production deployment. Record its expected
   `sha` and `deployment_id`.
2. In Vercel Project Settings, open Cron Jobs and select **Disable Cron Jobs**.
   Wait for any request that is already running to finish.
3. Run `vercel rollback <deployment-url>`, then run `vercel rollback status`.
   Instant rollback reassigns domains to the existing deployment and does not
   rebuild it.
4. Read `/api/release` on the production domain. Require the exact recorded SHA
   and deployment ID before accepting the rollback.
5. Keep cron jobs disabled. Vercel Instant Rollback does not update the active
   cron job registrations. Restore the intended code and `vercel.json` on
   `main`, then use the normal candidate, tag, and promotion path to create a new
   production deployment and register that cron configuration.
6. In Vercel Project Settings, confirm that the registered paths and schedules
   match `vercel.json`. Enable Cron Jobs only after that check. Confirm that the
   next scheduled requests reach the active release. They must not return
   `Inactive release`.

Code rollback does not change the Founder DNA active data-release pointer, undo
Neon writes or refund purchases. Founder DNA activation and rollback remain
separate explicit operator commands with their own production authorization.
The CD workflow never runs migrations or data-release mutation commands. Avoid
schema-destructive changes; take a database snapshot/branch before a
maintainer-approved migration.

## Forking

1. Fork the repo and create a Vercel project using Next.js and pnpm.
2. Select Node 22. Update the public site URL and attribution in `lib/site.ts`
   before deploying; these own canonical metadata, structured data, robots and
   sitemap URLs.
3. Start without paid credentials. The UI should render an empty directory.
4. Provision your own Neon database. Use a different database/branch for
   previews.
5. Enable **Automatically expose System Environment Variables** in the Vercel
   project. The release proof and cron release guard require these values.
6. Add `DATABASE_URL`, `WEFT_API_KEY`, and a strong `CRON_SECRET` to the
   intended server environment only. Get a Weft key from the buyer dashboard
   linked in the README. Set wallet limits before enabling collection. Optional
   product analytics: a public PostHog project token as
   `NEXT_PUBLIC_POSTHOG_KEY` (must start with `phc_`) and
   `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`. Create a dedicated
   Founders Directory project. Do not reuse another app's token. The online-now
   chip counts Neon heartbeats, not PostHog.
7. Review [vercel.json](../vercel.json): it schedules a scan every five minutes,
   enables branch previews and excludes `main` from Git auto-deploy. Remove or
   disable the schedule in your fork until you explicitly want paid collection.
   To use Vercel Git for production too, remove the `main` exclusion and skip
   the CD secrets.
   Check your Vercel plan's cron limits; this frequency is not a promise of
   free hosting. Do not copy production credentials into preview builds.
8. Deploy a preview, verify UI/metadata/unauthorized cron, then let successful
   `main` CI create the staged production candidate. Tag that exact current SHA
   and approve its existing deployment for production. A paid smoke is a
   separate, budgeted operator decision.

A Vercel clone does not come with a database, funded wallet, or free provider
calls.

## Place repair

`scripts/normalize-places.ts` is an explicit paid database maintenance task, not
a CI step. With the intended environment loaded, run:

```sh
pnpm exec tsx --env-file=.env.local scripts/normalize-places.ts
```

It processes distinct locations in batches of 40 and requires complete mappings
before starting writes. Updates compare the original location to avoid overwriting
concurrent edits. A mid-write database failure can still leave partial progress;
the command is not an atomic migration. Read back city/country values, check
known real places and non-places, and do not treat “updated” alone as success.

Never run `scripts/bulk.ts` as a smoke test. It can hydrate many paid profiles.
