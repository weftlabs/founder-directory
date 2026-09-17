# Contributing

Small, useful improvements are welcome: accessibility, search, documentation,
provider parsing and reliability. Start with an issue for a new feature or a
change to paid behavior. Keep one PR focused on one user-visible outcome.

## Local loop

1. Fork and create a branch from `main`.
2. Use Node 22 and pnpm 10.33.4; run `pnpm install --frozen-lockfile`.
3. Run `pnpm dev`. With no credentials, the directory is empty and cron is unauthorized.
4. Write the smallest regression test. Use synthetic profiles, never real profile dumps.
5. Change the owning code. Keep Next.js routes thin and Weft calls on the server.
6. Run `pnpm verify`.
   Install Chromium once with `pnpm exec playwright install chromium`.
7. Open a PR with the behavior change, test output, risks, and untested paths.

Do not include `.env` files, wallet/API keys, deployment metadata, credentials,
private planning material, or screenshots containing personal data. Do not make
paid calls merely to validate a refactor.

## Review standard

A passing test should demonstrate an outcome, not mirror an implementation.
Check the default path and failure paths. Typecheck is not a test; build success
is not browser QA. Explain any changed spending cap or database behavior.
UI changes should include desktop/mobile evidence. Docs change in the same PR
as the behavior they describe.

A maintainer reviews tradeoffs and authorizes merge. CI must pass on the current
head. We do not auto-merge dependency or agent-generated PRs.

## Community expectations

Be respectful and specific. Critique code, not people. No harassment, doxxing,
spam, or unsolicited scraping/outreach features. Use GitHub issues for public
bugs and feature requests; follow [security reporting](SECURITY.md) for secrets,
vulnerabilities and personal-data concerns. Never post private evidence publicly.

## Where to learn more

- [Code guide](docs/code-guide.md)
- [Testing](docs/testing.md)
- [Weft integration](docs/weft.md)
- [Harness approach](docs/harness.md)
