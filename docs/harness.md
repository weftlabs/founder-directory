# A small, verifiable contributor harness

Inspired by OpenAI's [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
(Ryan Lopopolo, February 11, 2026). This is an application of its principles to a
small public product, not a reproduction of OpenAI's system or a quality endorsement.

## What we adopt

- **A map, not a manual:** [AGENTS.md](../AGENTS.md) points to short, owned guides.
- **Repository knowledge:** contributors can learn the app from a standalone fork.
- **Mechanical feedback:** formatting, lint, type checks, behavior tests, local
  documentation links, branding and client/server import checks run in CI.
- **Visible behavior:** Playwright drives a real production build at desktop and
  mobile widths. Traces help reproduce failures without production credentials.
- **Small changes:** human intent, focused regression, implementation, independent
  review, current-SHA CI, maintainer merge. Agents do not self-certify success.
- **Honest gaps:** [quality.md](quality.md) names what the harness does not prove.

## Skills

[Weft changes](../.agents/skills/weft-change/SKILL.md) and
[verification](../.agents/skills/verify-change/SKILL.md) are portable, repo-owned
workflows. They do not require a private company workspace, a particular agent
vendor, or privileged access. Add a skill only for a repeatable workflow; link
the owning guide rather than duplicating it.

## What we deliberately do not build

No full observability stack, autonomous publishing loop, hidden internal skill
bundle, or elaborate agent framework. A small app benefits more from cheap,
reliable feedback than from copying a million-line repository's infrastructure.
Docs and tests evolve with real failures. Do not add ceremony without a concrete
failure mode it prevents.
