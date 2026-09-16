# Deploying

This repository deploys through GitHub Actions, not Vercel Git auto-deploy.
[CD](../.github/workflows/cd.yml) builds once with the Vercel CLI and uploads
prebuilt output.

| Event                  | Deployment                       |
| ---------------------- | -------------------------------- |
| Merge (push to `main`) | Vercel **preview**               |
| Semver tag (`vX.Y.Z`)  | Vercel **production** (`--prod`) |

CI still gates merge. A green check is not a live release. Production is the
tagged commit only.

## Maintainer setup

1. Create a Vercel access token and read `orgId` / `projectId` from
   `.vercel/project.json` after `vercel link` (do not commit that folder).
2. Set repository secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and
   `VERCEL_PROJECT_ID`.
3. Keep production env vars (`DATABASE_URL`, `WEFT_API_KEY`, `CRON_SECRET`) on
   the Vercel production environment. Use a different Neon branch and wallet
   limits for preview. Never put those values in GitHub Actions as
   `NEXT_PUBLIC_*` or in this repo. Optional product analytics: a public
   PostHog project token as `NEXT_PUBLIC_POSTHOG_KEY` (must start with `phc_`)
   and `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`. Create a dedicated
   Founders Directory project. Do not reuse another app's token. The online-now
   chip counts Neon heartbeats, not PostHog.
4. Leave Git auto-deploy off. `vercel.json` sets `git.deploymentEnabled` to
   `false` so a merge cannot also promote production.

Release:

```sh
git tag v0.1.0 <green-sha>
git push origin v0.1.0
```

CD then pulls production env, runs `vercel build --prod`, and deploys with
`--prebuilt --prod`. Cron in `vercel.json` runs on production only.

## Rollback

Promote a previously verified production deployment in Vercel. Code rollback
does not undo Neon writes or refund purchases. Suspend cron first during an
upstream incident. Avoid schema-destructive changes; take a database
snapshot/branch before a maintainer-approved migration.

## Forking

1. Fork the repo and create a Vercel project using Next.js and pnpm.
2. Select Node 22. Update the public site URL and attribution in `lib/site.ts`
   before deploying; these own canonical metadata, structured data, robots and
   sitemap URLs.
3. Start without paid credentials. The UI should render an empty directory.
4. Provision your own Neon database. Use a different database/branch for
   previews.
5. Add `DATABASE_URL`, `WEFT_API_KEY`, and a strong `CRON_SECRET` to the
   intended server environment only. Get a Weft key from the buyer dashboard
   linked in the README. Set wallet limits before enabling collection. Optional
   product analytics: a public PostHog project token as
   `NEXT_PUBLIC_POSTHOG_KEY` (must start with `phc_`) and
   `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`. Create a dedicated
   Founders Directory project. Do not reuse another app's token. The online-now
   chip counts Neon heartbeats, not PostHog.
6. Review [vercel.json](../vercel.json): it schedules a scan every five minutes
   and disables Git auto-deploy. Remove/disable the schedule in your fork until
   you explicitly want paid collection. To use Vercel Git instead of Actions,
   remove `git.deploymentEnabled` or set it true, and skip the CD secrets.
   Check your Vercel plan's cron limits; this frequency is not a promise of
   free hosting. Do not copy production credentials into preview builds.
7. Deploy a preview, verify UI/metadata/unauthorized cron, then tag the exact
   reviewed commit for production. A paid smoke is a separate, budgeted
   operator decision.

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
