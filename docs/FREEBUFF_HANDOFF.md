# Freebuff handoff — GM Crypto Ecosystem

## Owner objective

Continue the existing GM Crypto Ecosystem repository and turn it into a professional, maintainable, cost-aware crypto market intelligence and simulation product with a disciplined multi-agent AI development workflow.

The owner has asked for the maximum useful preparation before Freebuff performs the implementation. Treat this repository as the source of truth. Do not start over, replace the application, or discard existing pull requests.

Repository: https://github.com/GiuSMart/GM-crypto-ecosystem  
Default branch: `main`  
Current handoff branch: `chore/agent-skills-freebuff-handoff`  
Stack: Next.js 16, React 19, TypeScript, Node.js >=22, SQLite via `node:sqlite`.

## Read first

1. `AGENTS.md`
2. `docs/GM_AGENT_PLATFORM.md`
3. `docs/SKILLS_GOVERNANCE.md`
4. `docs/GM_FREEBUFF_EXECUTION_BACKLOG.md`
5. `docs/FREEBUFF_HANDOFF.md`
6. `README.md`, `docs/ARCHITECTURE.md`, `docs/PHASES.md`, `docs/RELEASE_CHECKLIST.md`, `docs/API.md`
7. All relevant `.agents/skills/*/SKILL.md`

Inspect all open PRs, branches, current default branch SHA, workflow files and CI before changing anything. Use isolated branches/worktrees. Do not push directly to `main`.

## Existing work — preserve it

At handoff preparation time:
- PR #21 — Agent Skills and Freebuff handoff: open draft PR; this handoff branch is its head. Continue updating this PR rather than creating a duplicate.
- PR #20 — BTC asymmetric strategy foundation for Revolut X: separate open draft PR. Do not overwrite, close, rebase or merge it without owner approval.
- Other open work exists, including Affiliate Center, phase-1 hardening, Bybit/OKX market-data, worker, signals and analytics. Inspect current live status; the list may have changed.

Do not assume any PR is merged or any test passed based only on an old description. Verify current head SHA and CI.

## Mandatory safety boundaries

- Public market data, market analysis and paper trading only.
- Live order placement remains impossible: preserve the intentional hard stop in `src/lib/live.ts`. Do not add private order endpoints or a path that bypasses the hard stop.
- No withdrawals, transfers, custody, private-key/seed-phrase collection or wallet signing.
- Wallets remain watch-only. Any future account connection must be read-only and least-privilege.
- Unknown exchange fees, network costs, minimum size, precision, regional eligibility, stale books, incomplete depth, unsupported pairs or uncertain fills must fail closed. Never substitute zero for unknown.
- Keep the multi-venue arbitrage engine separate from the BTC asymmetric strategy.
- AI may explain data and coordinate work; deterministic TypeScript code remains the authority for arithmetic, fees, sizing, risk and eligibility.
- Never promise profit, income or guaranteed returns. Label all paper results as simulations.
- Never place credentials, tokens, secrets, customer data or personal account information in source, logs, prompts, fixtures, screenshots or reports.
- Human approval required before merging, production deployment, spending money, publishing campaigns, changing financial risk limits or any external financial side effect.

## Agent operating model

Use one logical coordinator, **GM MASTER AI**, and bounded specialist roles. The roles are not automatically running agents; Skills are reusable instructions, not a runtime.

Core roles:
- Master Orchestrator
- Crypto Architect
- Quant Engine
- BTC Strategy
- Arbitrage Engine
- Risk Manager
- Revolut X Integrator
- Security Auditor
- Code Quality / Test Engineer
- Skills Manager
- Database Architect
- Growth & Commercial Strategy

Do not create many autonomous agents that edit the same files. Every task must have one owner, bounded scope, base SHA, isolated branch/worktree, allowed tools, risk level, acceptance criteria, tests, budget/stop condition and required report. Workers return commit SHA, changed files, exact validation results, assumptions and unresolved decisions.

## Skills policy

Project-local Skills are in `.agents/skills/`:
- `gm-crypto-risk-review`
- `gm-crypto-quality`
- `gm-master-orchestrator`
- `gm-skills-manager`

External Skills are not installed merely because they are popular or listed as official. Follow `docs/SKILLS_GOVERNANCE.md`.

Initial candidates to inspect (not blanket approval):
- Vercel: `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `next-best-practices`, `ai-sdk`.
- Testing/workflows: `test-driven-development`, `webapp-testing`, `verification-before-completion`, `systematic-debugging`, `using-git-worktrees`, `requesting-code-review`.
- Revolut X package: `revx-account`, `revx-auth`, `revx-market`, `revx-strategy`, `revx-trading`, `revx-monitor`, `revx-telegram`. Review the actual files and permissions; `revx-auth` and `revx-trading` are high sensitivity and must not enable private order or transfer features.
- Official OpenAI, GitHub, Coinbase, Cloudflare, Sentry and database-maker Skills only when relevant to an actual feature.

Do not install all Skills, use wildcard installation, or install globally by default. Review upstream license, full SKILL.md, scripts, dependencies, shell/network/filesystem/env access, compatibility, duplicates, hash and every available audit provider. A changed hash invalidates the prior review. Audit pass is not a security guarantee. Missing/pending audits are unknown. Any fail or HIGH/CRITICAL result means reject/quarantine; MEDIUM means manual review; conflicting providers use the most conservative result. Installation/update requires owner approval.

CLI telemetry: prefer `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` where supported. Do not enable telemetry solely to customize the skills.sh page. Do not add automatic `prepare` install hooks or experimental sync until tested and approved.

## Skills.sh API implementation guidance

Use `https://skills.sh/api/v1/` for read-only discovery:
- `GET /skills` for all-time/trending/hot and repository-specific inventory.
- `GET /skills/search?q=...` for discovery.
- `GET /skills/curated` for official first-party Skills.
- `GET /skills/{source}/{skill}` for file snapshots and SHA-256 hash.
- `GET /skills/audit/{source}/{skill}` for partner audits; documentation says this endpoint requires authentication.

Test public catalogue endpoints without authentication first. Do not assume every endpoint has the same authentication requirement. If authenticated audits are necessary, use request-scoped Vercel OIDC server-side in a linked Vercel project and the documented helper; never cache the token at module scope, expose it to the browser, log it or commit `.env.local`. Respect Cache-Control, pagination, 429 Retry-After and 503 backoff. Do not poll continuously.

First Skills Manager release should be read-only discovery plus review records. No automatic install, update or execution of fetched Skills.

## Cost and infrastructure policy

Owner's target is zero additional spend wherever feasible. Do not promise every provider or deployment can be free forever. Prefer existing repository, GitHub PRs/Actions, local project Skills and existing TypeScript/SQLite stack. Use provider free tiers only after checking current limits, required billing details, quotas and overage behavior.

Vercel AI SDK, AI Gateway, Sandbox, Workflows, Queues, Fluid Compute, Observability, Redis, PostgreSQL, Python/FastAPI, Turborepo and mobile/Expo are optional candidates, not requirements. Before adding any service/dependency, document why the current stack is insufficient, expected recurring/overage cost, limits, security and a simpler alternative. Do not use serverless/ephemeral filesystem for the existing SQLite worker. Do not claim 24/7 service without a persistent host, restart policy, monitoring and backup/restore plan.

## Strategy PR #20 — owner decision required

The PR description identifies an unresolved conflict in the supplied BTC strategy PDF: one passage says a DCA drawdown threshold above 5%, another says -8%. Do not silently choose or alter the threshold. Locate the exact source passages and ask the owner to decide.

Also verify:
- 40/40/20 allocation and daily accumulation/DCA rules;
- exact net Take Profit gross-up, buy/sell fees and maker/taker assumptions;
- partial fills, rounding, EUR quote currency, trigger boundaries, daily reset/timezone and maximum exposure;
- tests, typecheck, build and CI on the exact PR head.

No Revolut X API call, credentials, order router or live trading is implied by PR #20. Keep it simulation/documentation only unless the owner approves a separately reviewed scope.

## Execution order

Follow `docs/GM_FREEBUFF_EXECUTION_BACKLOG.md`. In short:
1. Verify repository, PRs, CI and branch integrity.
2. Validate and complete the documentation/handoff PR #21.
3. Audit the existing application and open PRs; report critical/high findings before broad feature work.
4. Resolve the owner decision in PR #20 before changing the DCA threshold.
5. Build a read-only Skills catalogue/review MVP only after architecture, privacy and test design.
6. Add bounded agent orchestration only after task state, permissions, isolation, retries, cancellation, cost tracking and audit trail are designed.
7. Improve operational readiness (persistent worker, monitoring, backup/restore, security controls).
8. Product/growth work only after core correctness and safety.

## Required validation

Run in the repository environment:
```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Report the exact branch and commit SHA and actual outcome for every command. Run targeted tests for changed behavior. If a command cannot run, state why and leave it pending. Do not inherit a green result from an earlier commit.

## Definition of done

- No unresolved Critical/High security or financial-correctness finding in the touched scope.
- All tests/typecheck/build pass on the exact PR head, or blockers are explicitly recorded.
- No unreviewed external Skill is installed or executed.
- No new paid dependency/service without owner approval.
- Live trading and withdrawals remain disabled.
- Documentation distinguishes implemented, simulated, planned, unverified and blocked.
- Work is delivered in focused PRs, not direct commits to `main`.
- Freebuff returns a ranked audit report, implementation sequence, changed files, commit SHAs, validation evidence, costs and owner decisions required.
