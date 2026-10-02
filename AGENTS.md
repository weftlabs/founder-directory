# Working on Founder Directory

A public, working founder directory and a small example of app functions powered by Weft.

## Start here

- [README](README.md): run the product.
- [Contributor guide](CONTRIBUTING.md): make a reviewable change.
- [Documentation map](docs/README.md): navigate the maintained knowledge.
- [Code guide](docs/code-guide.md): source boundaries and data flow.
- [Testing](docs/testing.md): prove behavior without spending money.
- [Deployment](docs/deployment.md): isolated previews, production and rollback.
- [Security](SECURITY.md): report sensitive issues privately.

## Working rules

- Preserve unrelated work. Use a branch or isolated worktree from current `main`.
- Read the owning code and tests before editing. Add a focused regression test.
- Keep business functions independent of UI. Weft stays underneath, server-side.
- Never put credentials in `NEXT_PUBLIC_*`, fixtures, logs, PRs or screenshots.
- Treat provider output as untrusted. Fail closed; do not invent founder data.
- Paid requests, database writes and production deploys need explicit scope and budget.
- Do not retry ambiguous payments or raise price caps to make a test pass.
- Default verification is offline/no-spend. Never load production `.env.local` for CI.
- Keep docs beside the behavior they explain; update links when moving a file.
- Publish no internal company material, profile dumps or host-specific paths.
- Open a PR. Merge/deploy only with maintainer approval and current-SHA checks.

## Commands

Use Node 24.21.0 and the pinned pnpm version in `package.json`.

- `pnpm install --frozen-lockfile`
- `pnpm dev` (no keys needed for an empty directory)
- `pnpm test` for the inner loop
- `pnpm check` for formatting, lint, types, tests and repository checks
- `pnpm build && pnpm test:e2e` for production-mode browser smoke

## Repo-local skills

Load only the skill relevant to the task:

- [Safe Weft changes](.agents/skills/weft-change/SKILL.md)
- [Contribution verification](.agents/skills/verify-change/SKILL.md)

These files are public contributor instructions, not hidden dependencies on an internal workspace.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
