# Documentation map

This is the public contributor knowledge base. Executable configuration owns
commands and behavior; update these guides alongside code rather than keeping
a second, conflicting specification.

| Question                                    | Guide                                            |
| ------------------------------------------- | ------------------------------------------------ |
| How do I run and fork it?                   | [README](../README.md)                           |
| How do I contribute?                        | [Contributing](../CONTRIBUTING.md)               |
| Where does code belong?                     | [Code guide](code-guide.md)                      |
| How does Weft power the app?                | [Weft integration](weft.md)                      |
| How do I preserve and reprocess enrichment? | [Enrichment operations](enrichment.md)           |
| How do I verify a change?                   | [Testing](testing.md)                            |
| How do I deploy, tag, or roll back?         | [Deployment](deployment.md)                      |
| How do agents work in this repo?            | [Harness](harness.md) and [AGENTS](../AGENTS.md) |
| What is proven and what is missing?         | [Quality and limitations](quality.md)            |
| How do I report sensitive issues?           | [Security](../SECURITY.md)                       |

`pnpm check:repo` validates local Markdown file links and selected repository
boundaries. It does not verify remote links or replace human documentation review.

- [Founder map](discovery.md): locations, bounded discovery data and local previews.
