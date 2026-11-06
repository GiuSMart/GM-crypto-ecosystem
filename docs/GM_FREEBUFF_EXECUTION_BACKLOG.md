# GM Crypto Ecosystem — Freebuff execution backlog

This backlog is the recommended implementation order. Re-check repository and PR status before every phase; statuses can change. Do not treat a planned item as implemented.

## P0 — Establish a verified baseline

- [ ] Inspect `main`, all open PRs, branches, CI runs, rulesets and recent commits.
- [ ] Identify duplicate/malformed workflow files and determine the actual active CI workflow before editing. Do not delete files solely because their names look unusual.
- [ ] Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm audit --omit=dev --audit-level=high` on the exact base commit.
- [ ] Confirm current live-order hard stop and that no route can bypass it.
- [ ] Produce ranked security/financial/operational findings with evidence and file/line references.

**Acceptance:** baseline report includes exact SHA, command results, open PR inventory and unresolved blockers.

## P1 — Complete agent handoff and governance

- [ ] Review PR #21 and the new project Skills/docs.
- [ ] Validate frontmatter and directory naming for all local Skills.
- [ ] Check links, JSON syntax in `skills.sh.json`, and docs consistency.
- [ ] Confirm the handoff never asks an agent to overwrite or merge PR #20.
- [ ] Keep PR #21 in draft until the exact head has been validated.

**Acceptance:** coherent handoff, no contradictory instructions, no third-party Skills installed by default, CI evidence attached.

## P2 — Review existing product work

- [ ] Inspect PR #19 Affiliate Center, PR #20 BTC strategy, PR #17 phase-1 hardening, PR #16 OKX, PR #18 venue host guard, and other currently open PRs. Re-check status; this list is not guaranteed current.
- [ ] Review authentication/authorization, tenant isolation, CSRF, rate limiting, secrets, database paths and admin mutations.
- [ ] Review exchange adapters, fees, order-book staleness/depth, regional host allowlists and retry behavior.
- [ ] Review worker persistence, singleton execution, graceful shutdown, restart, observability and backup/restore.
- [ ] Do not merge unrelated PRs or combine separate financial strategies without owner approval.

**Acceptance:** prioritized remediation plan; no Critical/High issue left unresolved in code being changed.

## P3 — Resolve BTC strategy owner decision

- [ ] Locate the source PDF passages describing the DCA drawdown threshold conflict (>5% versus -8%).
- [ ] Present exact passages and impact of each interpretation to the owner.
- [ ] Until the owner answers, do not change the threshold or present the strategy as finalized.
- [ ] Verify allocation, DCA cadence, fees, net Take Profit, maker/taker assumptions, partial fills, rounding, EUR handling, timezone and exposure limits.
- [ ] Run strategy tests and CI on exact PR head.

**Acceptance:** owner decision recorded in PR/docs; deterministic tests cover chosen rule and boundary conditions.

## P4 — Skills Intelligence read-only MVP

- [ ] Build a typed server-side client for skills.sh catalogue, search and curated endpoints.
- [ ] Start with unauthenticated read-only requests; test endpoint behavior and handle 404/429/503.
- [ ] Add caching based on Cache-Control, pagination and request deduplication.
- [ ] Persist or export review metadata: stable ID, source, slug, install URL, duplicate flag, installs, hash, files, audit provider/status/risk/timestamp, license, reviewer and decision.
- [ ] Treat missing/pending audit as unknown; fail/high/critical reject; medium/manual review; provider conflict uses conservative verdict.
- [ ] Add source hash change detection and mark prior review stale.
- [ ] Add unit tests using fixtures; never make tests depend on the live skills.sh API.
- [ ] Do not execute downloaded scripts or automatically install/update Skills.
- [ ] Add an admin review UI only after auth/tenant/CSRF design is verified.

**Acceptance:** read-only catalogue and review report work with mocked API fixtures, no secrets, no auto-install and tests cover pagination, caching, duplicates, stale hashes and conflicting audits.

## P5 — Bounded agent orchestration

- [ ] Specify task state machine: queued, running, blocked, succeeded, failed, cancelled, awaiting_approval.
- [ ] Define task contract, tool allowlist, file ownership, model/tool budget, retry/backoff, idempotency, cancellation and audit events.
- [ ] Begin with GitHub issues/PRs and Freebuff as the external execution coordinator; avoid paid queue/orchestrator dependencies.
- [ ] Introduce in-app workers only after persistent storage and process lifecycle are designed.
- [ ] Isolate code tasks in worktrees/branches and require independent review.
- [ ] Add usage/cost tracking and hard per-task limits before connecting paid model APIs.
- [ ] Keep deterministic financial calculations outside LLM decision-making.

**Acceptance:** tasks are traceable, cancellable, isolated, budget-bounded and cannot trigger financial or production side effects.

## P6 — Operational readiness

- [ ] Choose persistent hosting for SQLite web + worker or complete a tested database migration first.
- [ ] Implement backups and restore drills; monitor disk, worker liveness, job lag and exchange API failures.
- [ ] Add process supervisor/restart policy and documented incident procedures.
- [ ] Assess 2FA, distributed rate limits, WAF/reverse proxy, tenant isolation and secure headers.
- [ ] Verify dependency/workflow supply chain and pin Actions to immutable SHAs where practical.
- [ ] Do not claim 24/7 or production readiness before evidence exists.

**Acceptance:** documented deploy topology, backup restore evidence, monitoring and recovery procedure.

## P7 — Product, analytics and growth

- [ ] Measure activation, retention, data freshness, paper simulation quality, false positives and operating cost.
- [ ] Improve onboarding and dashboard UX only after core data correctness and security.
- [ ] Marketing claims must be substantiated; no guaranteed profit or fake performance.
- [ ] Paid campaigns, paid tools, public posts and commercial policy changes require owner approval.

**Acceptance:** measurable product metrics and approved, evidence-based messaging.

## Global stop conditions

Stop and ask the owner when:
- a financial rule is ambiguous;
- a change would enable live orders, withdrawals, transfers or custody;
- a new recurring cost or payment method is required;
- credentials or private customer data are needed;
- a migration could destroy or expose data;
- production deploy, merge, publication or risk-limit change is requested;
- tests fail or a Critical/High finding is discovered.

## Final report required from Freebuff

Provide:
- verified baseline SHA and open PR status;
- completed phases and exact commit/PR links;
- files changed;
- exact validation commands/results;
- security and financial findings by severity;
- current costs and free-tier limitations;
- features actually implemented versus planned;
- unresolved owner decisions and recommended next task.
