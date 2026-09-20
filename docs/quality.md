# Quality and known limits

This is a contributor checklist, not a badge, SLA or claim of production maturity.
The current commit's CI output owns which checks passed.

| Area                | Automated evidence                                                                                            | Remaining gap                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Presentation        | Production-build desktop/mobile smoke; empty founders API                                                     | Populated-directory pagination e2e; sitemap still lists all founders                                                   |
| Domain logic        | Synthetic unit tests                                                                                          | Broader international location evaluation                                                                              |
| Weft reliability    | Missing-key, retry, payload, and scan budget tests                                                            | Live upstream availability, durable payment reconciliation; a single hung Weft call can still hit the platform timeout |
| Persistence         | Parameterized queries; guarded repair updates                                                                 | Isolated database integration suite and versioned migrations                                                           |
| Visitor analytics   | Typed event catalog, privacy unit test, fictional browser interaction test; client no-op without `phc_` token | Live event readback from the dedicated PostHog project; DB-backed online count                                         |
| Delivery            | Frozen lockfile, pinned actions, no-secret CI                                                                 | Maintainer-configured branch protection and deployment connection                                                      |
| Documentation       | Local file-link and public-file checks                                                                        | Human review of meaning and remote-link currency                                                                       |
| Data responsibility | Source links and public reporting guidance                                                                    | Self-service correction/removal, retention automation                                                                  |

## Priorities for follow-up contributions

1. Add a separate ephemeral-database integration suite; never use production Neon in CI.
2. Move schema bootstrap to explicit versioned migrations with rollback guidance.
3. Add deterministic populated-directory browser tests using synthetic fixtures.
4. Improve country/city validation without guessing ambiguous free text.
5. Design profile correction/removal and retention with the deployment operator.
6. Add circuit-breaker observability for hung Weft calls; per-tick search and hydration caps already bound cooperative work.

ESLint 9 is pinned because the current Next.js lint plugins still declare ESLint
9 peers; its upstream lifecycle warning is known. Upgrade the compatible plugin
set together rather than masking peer conflicts with a forced install.

Do not describe a provider timeout as an app fix, an empty chip as successful
normalization, or a merged commit as a verified production deployment.
