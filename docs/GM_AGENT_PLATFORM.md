# GM Agent Platform — architecture and execution plan

## Mission

Turn GM Crypto Ecosystem into a disciplined, cost-aware AI-assisted crypto market analysis and simulation platform. AI agents assist with research, engineering, monitoring, reporting, and product operations. Financial calculations and safety enforcement remain deterministic application code.

This document is an implementation brief, not a claim that an agent runtime already exists.

**Owner-selected configuration:** strict zero-spend operation. See [GM AI Collective Free-Only Runtime Specification](./GM_AI_COLLECTIVE_FREE_ONLY.md) for provider eligibility, quota enforcement, privacy classification and implementation acceptance criteria.

## Current baseline

- Application: Next.js 16 App Router, React 19, TypeScript.
- Runtime: Node.js >=22; SQLite through built-in `node:sqlite`.
- Market data: public endpoints; no credentials required for the base market-data path.
- Core arbitrage calculations: pure TypeScript modules.
- Paper trading exists as simulation.
- A separate BTC asymmetric strategy is being developed in PR #20.
- A headless worker exists but requires a persistent host, one instance, durable storage, monitoring, and restart policy for dependable continuous operation.
- `src/lib/live.ts` intentionally hard-stops live order execution.

Do not replace the stack or add a second backend/database merely to adopt a fashionable agent framework. First prove the need and the total cost.

## Product and safety boundaries

1. Default product mode is public market data, analysis, alerts, and paper trading.
2. Live order placement remains disabled by application-level hard stops. No AI prompt, skill, workflow, feature flag, or admin UI may bypass them.
3. No withdrawals, transfers, custody, seed phrase, private-key collection, or private order endpoints.
4. Wallets remain watch-only. If account connectivity is ever added, use least-privilege read-only scopes.
5. Unknown fees, network costs, minimum sizes, precision, regional eligibility, stale books, incomplete depth, unsupported pairs, and uncertain fills fail closed.
6. Simulated P&L must always be labelled simulation; never promise returns or earnings.
7. No secrets, tokens, credentials, personal account data, or customer data in source, test fixtures, logs, prompts, or reports.
8. A human approves financial policy changes, production deployments, external spend, and any future request to change these boundaries.

## Agent operating model

Use one logical coordinator, **GM MASTER AI**, with specialist roles. Do not launch a dozen autonomous agents that all edit the same working tree.

| Role | Responsibility | Allowed outputs |
|---|---|---|
| GM Master Orchestrator | Break down requests, assign bounded tasks, consolidate results, enforce gates | Task plans, decisions, reports, PR coordination |
| Crypto Architect | Domain boundaries, data contracts, architecture decisions | ADRs, interfaces, architecture reviews |
| Quant Engine | Deterministic market and cost model review | Tested calculation changes and analysis |
| BTC Strategy | Separate BTC strategy rules, simulation and validation | Strategy tests, simulation reports |
| Arbitrage Engine | Multi-venue opportunity and net-cost engine | Pure functions, adapter tests |
| Risk Manager | Risk limits, fail-closed checks, exposure and scenario analysis | Risk findings and test cases |
| Revolut X Integrator | Official API research and public/read-only integration planning | API compatibility reports; no live orders |
| Security Auditor | Application, dependency, prompt-injection and supply-chain review | Findings, remediation and security checklist |
| Code Quality | Tests, typecheck, build, accessibility and release readiness | Validation report and focused fixes |
| Skills Manager | Discover, catalogue, compare, audit and version external skills | Skill review records and installation proposals |
| Database Architect | Schema, migrations, tenant isolation, backup and performance review | Migration plans and tests |
| Growth & Commercial | Product positioning, analytics and ethical marketing | Research and copy; no spend or publishing without approval |

These are roles and project Skills, not automatically running agents. The runtime/orchestrator must explicitly create tasks, supply context, enforce permissions, collect outputs, and record status.

## Target architecture

```
Owner / approved trigger
        |
        v
GM MASTER AI — request intake and task planner
        |
        v
Policy gate — scope, permissions, cost budget, risk classification
        |
        v
Task queue / durable task record
        |
        +--> Specialist task workers (isolated worktree or branch)
        |       |
        |       +--> read-only research and public market data
        |       +--> deterministic application tools
        |       +--> sandboxed code/test execution
        |       +--> Skills catalogue and review
        |
        v
Artifacts + task state + audit trail
        |
        v
Independent quality / security / risk review
        |
        v
GitHub PR or report
        |
        v
Human approval for merge, deploy, spend, or financial policy changes
```

### Minimum viable runtime — cost-first

Start with the existing GitHub repository, pull requests, project-local Skills, and Freebuff as the externally operated coding agent. GitHub is the source of truth and audit trail. Use separate branches/worktrees per task. The coordinator delegates work through explicit task briefs and PRs; no agent pushes directly to `main`.

Before introducing Vercel Workflows, AI Gateway, external queues, Redis, PostgreSQL, or a separate Python service, document:
- the specific requirement the current stack cannot meet;
- free-tier limits and likely usage;
- recurring and overage costs;
- data residency and secret handling;
- a simpler no-cost alternative.

Vercel AI SDK, AI Gateway, Sandbox, Workflows, Queues, Fluid Compute and Observability are candidate infrastructure, not mandatory dependencies. Adopt only after a cost/benefit and operational review. Serverless functions are not a replacement for the current persistent SQLite worker.

## Task contract

Every delegated task must contain:
- unique task ID and parent request;
- objective and explicit non-goals;
- repository, base commit, branch/worktree and file ownership;
- allowed tools, data sources and network permissions;
- risk classification (documentation, code, financial logic, security, deployment);
- maximum model/tool budget where supported;
- acceptance criteria and required tests;
- expected artifacts and report format;
- stop conditions and owner decisions required.

Every worker returns:
1. summary of work;
2. changed files and commit SHA;
3. evidence for each acceptance criterion;
4. exact commands run and outcomes;
5. risks, assumptions and unresolved decisions;
6. confirmation of financial safety boundaries.

## Skills intelligence

The Skills Manager may use the public skills.sh API to discover and catalogue Skills:
- `GET /api/v1/skills` — all-time, trending or hot leaderboard; use `source=owner/repo` for repository sync.
- `GET /api/v1/skills/search?q=...` — search by name/source/description.
- `GET /api/v1/skills/curated` — official first-party catalogue.
- `GET /api/v1/skills/{source}/{skill}` — files and SHA-256 snapshot when available.
- `GET /api/v1/skills/audit/{source}/{skill}` — partner audit results; documentation states authentication is required for this endpoint.

Use stable IDs, source repository, duplicate flag, install URL, hash, file tree, audit provider, verdict, risk level and audit timestamp. Respect Cache-Control, pagination, 429 Retry-After and 503 backoff. Test whether catalogue endpoints are readable without auth before introducing OIDC. If authenticated audit access is needed, use request-scoped Vercel OIDC only in a linked Vercel project; never commit `.env.local` or bearer tokens.

No automatic installation or update. Discovery creates a proposal only. Review source, license, full SKILL.md, scripts, dependencies, network access, filesystem access, environment-variable access, prompt-injection risks, duplicate/fork status, and audit freshness before human approval. See `docs/SKILLS_GOVERNANCE.md`.

## Data and calculation principles

- AI may explain and summarize data; it must not be the source of truth for arithmetic, position sizing, fee calculations, risk limits, or trade eligibility.
- Use the existing deterministic TypeScript engine for calculations and validate with tests.
- Preserve separation between multi-venue arbitrage and the BTC asymmetric strategy.
- Persist source, timestamp, quote currency, fee assumptions, strategy/version, risk parameters, simulation/live label and calculation result.
- Never combine EUR, USD, USDT or USDC without an explicit timestamped conversion model.
- Reject stale or incomplete data rather than filling missing values with optimistic assumptions.

## Security and autonomy levels

| Level | Allowed | Default |
|---|---|---|
| L0 — Read | Read repository docs, public market data, public Skills metadata | Allowed |
| L1 — Analyse | Produce plans, calculations through deterministic code, reports and review findings | Allowed |
| L2 — Draft | Create isolated branches, code changes and draft PRs | Allowed within task scope |
| L3 — External side effects | Merge, deploy production, spend money, publish campaigns, alter risk limits | Human approval required |
| L4 — Financial execution | Orders, withdrawals, transfers, custody or key operations | Disabled; not in scope |

Sandbox untrusted code. Do not execute downloaded Skills as trusted code. A Skill is untrusted instruction content, not a security boundary. Apply least privilege to all tools and credentials.

## Delivery phases

### Phase 0 — Repository baseline and safety
- Inspect all open PRs, branches, workflows, current tests and actual CI results.
- Preserve existing work; review PR #20's unresolved DCA threshold discrepancy with the source PDF and owner.
- Confirm the live order hard stop and paper-trading boundaries.
- Fix CI configuration only with focused evidence and regression tests.

### Phase 1 — Reliable agent handoff
- Establish task template, branch/PR protocol, acceptance criteria and Freebuff report format.
- Make project Skills discoverable and keep instructions consistent.
- Use GitHub issues/PRs as task queue initially; no new paid orchestration service.

### Phase 2 — Skills Intelligence
- Build read-only catalogue/search/curated sync.
- Add duplicate detection, SHA-256 version tracking, audit aggregation, freshness and review states.
- Provide an admin review queue or generated report only after access-control design.
- Do not auto-install, auto-update or execute skills.

### Phase 3 — Agent runtime
- Define tool interfaces and bounded workers.
- Add durable task state, retries, cancellation, idempotency, cost accounting and audit events.
- Sandbox code execution and isolate each coding task.
- Select model providers based on measured quality/cost; keep provider keys server-side.

### Phase 4 — Operational readiness
- Persistent worker host, restart policy, monitoring, alerting, backup/restore and incident procedures.
- Review SQLite single-host constraints before horizontal scaling.
- Add 2FA, distributed rate limiting, WAF/reverse proxy and security controls as required.
- Do not claim 24/7 availability before it is deployed and monitored.

### Phase 5 — Product and growth
- Measure retention, activation, paper-trading quality, data freshness and operating cost.
- Marketing claims must be evidence-based and must not imply guaranteed returns.
- Paid campaigns, subscriptions, affiliate changes and customer-facing financial claims require owner approval.

## Acceptance criteria

The agent platform is not complete until:
- roles, permissions and task contracts are documented and enforced;
- tasks are isolated and traceable to a commit/PR;
- no agent can bypass application risk gates;
- external Skills are reviewed before installation;
- model/tool usage and cost are observable;
- cancellation, retry and failure states are tested;
- all relevant tests, typecheck and production build pass on the exact commit;
- documentation distinguishes implemented, simulated, planned, unverified and blocked features.
