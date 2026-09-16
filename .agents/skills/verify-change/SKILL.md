---
name: verify-change
description: Use when preparing a Founder Directory contribution for review.
---

# Verify a contribution

Read [contributing](../../../CONTRIBUTING.md) and [testing](../../../docs/testing.md).

1. Inspect the diff and preserve unrelated work. Name the changed user behavior.
2. Run its focused regression test. Check that it would catch the original bug.
3. Review failures, payment/privacy boundaries and docs with an independent reviewer.
4. Run `pnpm verify` without production credentials.
5. Check `git diff --check` and public-file hygiene. Include actual evidence and
   limitations in the PR, not a claim that the commands ought to pass.
6. Verify current-head CI and mergeability after pushing. Do not merge or deploy
   without maintainer approval; do not confuse code checks with production proof.
