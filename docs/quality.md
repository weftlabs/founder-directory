# Quality and known limits

This is a contributor checklist, not a badge, SLA or claim of production maturity.
The current commit's CI output owns which checks passed.

| Area                | Automated evidence                                         | Remaining gap                                                      |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Presentation        | Production-build desktop/mobile smoke                      | Populated-profile/filter end-to-end coverage                       |
| Domain logic        | Synthetic unit tests                                       | Broader international location evaluation                          |
| Weft reliability    | Missing-key, retry and payload contract tests              | Live upstream availability, durable payment reconciliation         |
| Persistence         | Parameterized queries; guarded repair updates              | Isolated database integration suite and versioned migrations       |
| Visitor analytics   | Client no-op without `phc_` token; presence UUID unit test | Dedicated PostHog project + production env; DB-backed online count |
| Delivery            | Frozen lockfile, pinned actions, no-secret CI              | Maintainer-configured branch protection and deployment connection  |
| Documentation       | Local file-link and public-file checks                     | Human review of meaning and remote-link currency                   |
| Data responsibility | Source links and public reporting guidance                 | Self-service correction/removal, retention automation              |

## Priorities for follow-up contributions

1. Add a separate ephemeral-database integration suite; never use production Neon in CI.
2. Move schema bootstrap to explicit versioned migrations with rollback guidance.
3. Add deterministic populated-directory browser tests using synthetic fixtures.
4. Improve country/city validation without guessing ambiguous free text.
5. Design profile correction/removal and retention with the deployment operator.
6. Add scan-level budget/circuit-breaker observability before increasing collection volume.

ESLint 9 is pinned because the current Next.js lint plugins still declare ESLint
9 peers; its upstream lifecycle warning is known. Upgrade the compatible plugin
set together rather than masking peer conflicts with a forced install.

Do not describe a provider timeout as an app fix, an empty chip as successful
normalization, or a merged commit as a verified production deployment.
