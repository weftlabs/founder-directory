# Deploying a fork

## Vercel + Neon

1. Fork the repo and create a Vercel project using Next.js and pnpm.
2. Select Node 22 and the production branch `main`. Update the public site URL
   and attribution in `lib/site.ts` for your fork before deploying; these own
   canonical metadata, structured data, robots and sitemap URLs.
3. Start without paid credentials. The UI should render an empty directory.
4. Provision your own Neon database. Use a different database/branch for previews.
5. Add `DATABASE_URL`, `WEFT_API_KEY`, and a strong `CRON_SECRET` to the intended
   server environment only. Get a Weft key from the buyer dashboard linked in
   the README. Set wallet limits before enabling collection.
6. Review [vercel.json](../vercel.json): it schedules a scan every five minutes.
   Remove/disable the schedule in your fork until you explicitly want paid
   collection. Check your Vercel plan's cron limits; this frequency is not a
   promise of free hosting. Do not copy production credentials into preview builds.
7. Deploy a preview, verify UI/metadata/unauthorized cron, then promote the exact
   reviewed commit. A paid smoke is a separate, budgeted operator decision.

Vercel's Git integration handles previews and production deployments when
connected by a project owner. CI checks code; it does not deploy or configure
that connection. A green GitHub check alone is not proof of a live release.

## Rollback

Use Vercel to promote a previously verified deployment. Code rollback does not
undo Neon writes or refund purchases. Suspend cron first during an upstream
incident. Avoid schema-destructive changes; take a database snapshot/branch
before a maintainer-approved migration.

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
