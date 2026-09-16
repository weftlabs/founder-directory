# Solo Founders

Public directory of people posting “I'm a solo founder” on X. Each person
has an indexable `/u/{handle}` page. Live: https://foundersdirectory.app

Weft runs in the background every five minutes. The directory does not show
receipts or prices. `/about` explains the X intro trend and why Weft is the
plumbing. Footer: built by [Nittarab](https://x.com/nittarab) and
[Weft Labs](https://weftlabs.com).

## Local

```sh
pnpm i
cp .env.example .env.local
pnpm dev
```

Required env: `DATABASE_URL` (Neon), `WEFT_API_KEY`, `CRON_SECRET`.

## CI

GitHub Actions on `main` and pull requests: `pnpm typecheck` then `pnpm build`.
No Weft calls, no `DATABASE_URL` / `WEFT_API_KEY` required at build time.

## Production

Production is Vercel (`weft-labs/solo-founders`). Auto-deploy from GitHub is
blocked until Patrick adds a Vercel GitHub login connection at
https://vercel.com/docs/accounts/create-an-account#login-methods-and-connections
then `vercel git connect`.

Until then, CD is:

```sh
vercel deploy --prod --scope weft-labs
```
