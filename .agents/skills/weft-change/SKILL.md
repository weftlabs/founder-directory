---
name: weft-change
description: Use when changing paid provider calls or parsing in Founder Directory.
---

# Safe Weft changes

Read [Weft integration](../../../docs/weft.md) and the owning adapter first.

1. Reproduce with a synthetic provider fixture, not a live paid call.
2. Preserve server-side credentials, operation identifiers and explicit caps.
3. Test missing keys, malformed/partial payloads, hard refusals and exhausted retries.
4. Never retry an explicit paid/held receipt or an ambiguous transport exception.
5. Fail closed to an empty place or skipped profile; bulk repair must not erase
   existing data when normalization is unavailable.
6. Run the focused test, then the gates in [testing](../../../docs/testing.md).
7. If live evidence is essential, obtain a scope and total budget first. Preserve
   sanitized receipts and stop at the budget. Never put keys or real dumps in Git.
