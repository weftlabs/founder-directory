# Founder Directory

Discover founders, what they are building, and where to find them.

[![CI](https://github.com/weftlabs/founder-directory/actions/workflows/ci.yml/badge.svg)](https://github.com/weftlabs/founder-directory/actions/workflows/ci.yml)
[![CD](https://github.com/weftlabs/founder-directory/actions/workflows/cd.yml/badge.svg)](https://github.com/weftlabs/founder-directory/actions/workflows/cd.yml)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fweftlabs%2Ffounder-directory&project-name=founder-directory&repository-name=founder-directory)

A working, public Next.js product and a contributor-friendly example of **app
functions powered by Weft underneath**. Visitors browse stored profiles, search
by name and filter by category, country or city. Each founder has an indexable
`/u/{handle}` page with source links. The hosted directory is at
https://foundersdirectory.app; its About page explains the source trend and
credits [Nittarab](https://x.com/nittarab) and [Weft Labs](https://weftlabs.com).

## Run locally

Use Node 22 and pnpm 10.33.4:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://127.0.0.1:3000. With blank credentials, the UI renders an empty
directory and collection stays unauthorized. To collect real data, provision
your own Neon `DATABASE_URL`, get a server-only `WEFT_API_KEY` from the
[Weft buyer dashboard](https://weft.network/dashboard/buyer/api_keys), and set
`CRON_SECRET`. Never prefix these with `NEXT_PUBLIC_`.

**Deploy safely:** merges to `main` deploy a Vercel preview; a `vX.Y.Z` tag
deploys production. The included cron schedule is every five minutes. Configure
wallet limits and isolate preview credentials before enabling it. A Vercel
clone does not come with a database, funded wallet, or free provider calls.
Read the [deployment guide](docs/deployment.md) first.

## What Weft does

Server functions discover public X introductions, hydrate profiles, and normalize
free-text locations. The app uses the Weft SDK rather than separate provider
credentials or an AI gateway. Provider/payment UI is not part of browsing.

Current per-request ceilings are **$0.01 for X search/profile requests** and
**$0.002 for place normalization**. These are caps, not quoted prices. Retries
can add cost; a scan is multiple requests. See [payment and failure semantics](docs/weft.md).

The current collection searches latest intro phrases for solo founders,
founders, builders, and indie hackers, then keeps first-person intros.
The product is not limited to one template. It does
not verify identities, guarantee location accuracy,
collect private accounts, message founders or automate outreach. Signal labels
are explainable heuristics, not reputation scores.

## Contribute

```sh
pnpm check
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

These checks need no paid credentials. Start with [CONTRIBUTING](CONTRIBUTING.md),
[the documentation map](docs/README.md), or [AGENTS](AGENTS.md) for an agent-assisted
change. The [quality tracker](docs/quality.md) names the gaps rather than hiding them.
Report sensitive issues using [SECURITY](SECURITY.md).

## License

[MIT](LICENSE). This covers the code, not rights to upstream profile data or third-party services.
