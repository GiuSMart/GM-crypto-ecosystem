# Agent Skills

This repository uses the open Agent Skills format to make coding-agent behavior repeatable.

## Project-local skills
Skills under `.agents/skills/` are part of this repository and should be used by Codex-compatible agents:
- `gm-crypto-risk-review` — trading logic, fees, paper trading, and risk controls.
- `gm-crypto-quality` — security, engineering quality, accessibility, and release review.

## Optional Vercel Agent Skills
The following skills are useful for the Next.js/React interface:
- `vercel-react-best-practices`
- `web-design-guidelines`
- `vercel-composition-patterns`

Install them locally (Node.js 22.20+ required):
```bash
npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices --skill web-design-guidelines --skill vercel-composition-patterns -a codex
```

Verify installation:
```bash
npx skills list
npx skills check
```

Do not install skills globally by default. Review third-party skill instructions before use; a skill is guidance for an agent, not a security boundary or proof that generated code is correct. Keep all financial and security controls enforced by application code and tests.
