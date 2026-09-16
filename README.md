# Solo Founders

Public directory of people posting “I'm a solo founder” on X. Each person
has an indexable `/u/{handle}` page.

Weft runs in the background every five minutes. The site never shows
receipts or vendor chrome.

## Local

```sh
pnpm i
cp .env.example .env.local
pnpm dev
```

Required env: `DATABASE_URL` (Neon), `WEFT_API_KEY`, `CRON_SECRET`.
