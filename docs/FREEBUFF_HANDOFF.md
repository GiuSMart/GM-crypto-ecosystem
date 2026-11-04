# Freebuff handoff — GM Crypto Ecosystem

## Purpose
Continue development from the current GitHub repository without replacing existing work. The owner wants a disciplined AI-assisted engineering workflow using project-local Agent Skills and selected Vercel Agent Skills.

Repository: https://github.com/GiuSMart/GM-crypto-ecosystem  
Default branch: `main`  
Project stack: Next.js 16, React 19, TypeScript, Node.js 22+, SQLite via `node:sqlite`.

## First actions for Freebuff
1. Connect to the repository and inspect `AGENTS.md`, this document, `README.md`, `docs/ARCHITECTURE.md`, `docs/PHASES.md`, and `docs/RELEASE_CHECKLIST.md`.
2. Inspect all open pull requests and branches before making changes. In particular, review the existing draft PR **#20 — Add BTC asymmetric strategy foundation for Revolut X**. Do not overwrite, close, merge, or rebase it without the owner's explicit instruction.
3. Install the selected official Vercel skills in the project for Codex-compatible agents, if the environment has Node.js 22.20+ and network access:
   ```bash
   npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices --skill web-design-guidelines --skill vercel-composition-patterns -a codex
   ```
   If the CLI rejects multiple `--skill` flags, install each skill in a separate command. Verify with `npx skills list`. Do not install globally unless the owner asks.
4. Read the two project-specific skills in `.agents/skills/` and follow root `AGENTS.md`.
5. Audit the current codebase and PR #20. Produce a ranked report before proposing code changes. Prioritize correctness, financial safety, test coverage, security, and operational readiness over new features.
6. Continue with small pull requests. Do not push directly to `main`.

## Selected Vercel skills and why
- `vercel-react-best-practices`: review React/Next.js rendering, data fetching, bundle size, and performance.
- `web-design-guidelines`: review accessibility, UX, responsive layouts, forms, and browser interaction.
- `vercel-composition-patterns`: keep reusable UI components composable and avoid prop-heavy components.

Project-local skills:
- `gm-crypto-risk-review`: trading calculations, fee assumptions, strategy isolation, and fail-closed risk controls.
- `gm-crypto-quality`: engineering/security/UX review and release validation.

## Current product boundaries — must preserve
- The existing arbitrage engine is separate from the BTC asymmetric strategy.
- The BTC strategy PR is a foundation for simulation/documentation only; its current PR description says it has no Revolut X API calls, no credentials, no order router, and no live trading.
- Public market-data integrations and paper trading only.
- Live order placement remains hard-disabled. Keep the intentional hard-stop in `src/lib/live.ts`.
- No withdrawals, transfers, custody, seed phrase, private-key collection, or private order endpoints.
- API keys must remain read-only and least-privilege.
- Unknown exchange fees, network fees, regional eligibility, stale books, incomplete depth, or uncertain execution must fail closed.
- Never promise income or represent paper-trading outcomes as realized profits.

## Strategy PR #20 review instructions
- Verify the BTC 40/40/20 allocation and daily accumulation/DCA rules against the supplied source PDF and the code/tests.
- The current PR description flags an inconsistency between a drawdown threshold stated as greater than 5% in one section and -8% in another. Do not silently choose or alter it: surface the exact source passages and request the owner's decision.
- Verify the 2% take-profit target using exact fee gross-up and show assumptions for both buy and sell fee rates.
- Verify whether maker/taker classification is known at simulation time; use actual fill type for realized costs, and conservative taker assumptions where fill type is unknown.
- Check rounding, EUR quote handling, partial fills, DCA trigger boundaries, daily reset/timezone, and maximum allocation/risk exposure.
- Run tests, typecheck, and production build on the exact PR head. The PR description currently says tests were added but not run; do not treat that as validated until CI or local execution proves it.

## Validation and reporting
Run:
```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```
Report the exact commit SHA and actual result of each command. Do not claim live API verification unless the public endpoint was actually reached. Do not claim 24/7 operation without a deployed persistent worker, monitoring, and restart policy.

## Definition of done
- No unresolved Critical/High security or financial-correctness issue.
- Tests cover strategy and risk boundaries.
- CI passes on the exact commit.
- Documentation distinguishes implemented, simulated, unverified, and pending capabilities.
- A pull request is ready for owner review; do not merge automatically.
