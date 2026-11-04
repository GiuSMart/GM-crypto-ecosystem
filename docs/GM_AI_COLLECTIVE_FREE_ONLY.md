# GM AI Collective — Free-Only Runtime Specification

**Owner-selected operating mode: FREE_ONLY.** This specification overrides earlier wording such as "free-first", "free wherever feasible", or "paid fallback". Permitted additional spend is exactly **EUR 0.00**.

This is an implementation specification. It does not claim that a multi-agent runtime or provider gateway already exists.

## 1. Non-negotiable cost policy

The system may use only a provider, model or service whose current usage is available at zero monetary cost under the owner's selected configuration.

Reject a provider or feature if it requires:
- paid plan, subscription, top-up, purchased credits or billing commitment;
- automatic overage or automatic paid fallback;
- a free trial that converts to a paid subscription;
- payment-card activation where zero-cost/no-overage behavior cannot be established;
- paid external hosting, queue, database, observability or orchestration.

Do not create or upgrade billing accounts. Do not store payment details. Do not infer that a model is free merely because its weights are open source: hosting, inference and bandwidth may still cost money.

If a provider changes its terms, quota or billing behavior, mark it REVIEW_REQUIRED and stop routing new work to it until re-approved. If all free providers are unavailable or exhausted, queue the task or run eligible local deterministic work. Never fall back to a paid provider.

Every task has:
- monetary budget: EUR 0.00;
- bounded request count;
- bounded input/output token budget where provider metadata allows;
- timeout and retry limit;
- explicit stop behavior for 429, 402, quota exhaustion, billing prompts or ambiguous pricing.

A zero-cost policy is a hard technical gate, not a preference or dashboard warning.

## 2. Provider eligibility registry

Each provider/model record must contain:
- stable provider and model identifiers;
- model version or revision;
- official pricing/plan URL and date last checked;
- free-tier eligibility evidence;
- whether payment-card or billing-account activation is required;
- request/token/credit limits and reset period;
- overage and automatic-upgrade behavior;
- data retention and model-training policy;
- region and availability restrictions;
- supported context length, tools and structured output;
- licence and acceptable-use terms;
- operational status and last successful health check.

Allowed states:
- DISCOVERED
- PENDING_REVIEW
- APPROVED_FREE
- QUOTA_EXHAUSTED
- REVIEW_REQUIRED
- SUSPENDED
- REJECTED

Only APPROVED_FREE models may receive tasks. Discovery never grants approval. Unknown pricing or billing behavior means PENDING_REVIEW, not free.

## 3. Provider gateway contract

Implement a server-only provider gateway behind a small internal interface. The gateway must:
1. accept a task and its risk/data classification;
2. filter the registry to APPROVED_FREE models compatible with that task;
3. check quota and task limits before making a request;
4. choose a provider using measured quality, availability and latency, not marketing claims;
5. record provider/model/version, task ID, timestamps, token usage if available, quota result and error category;
6. redact secrets and sensitive payloads from logs;
7. return a typed result or a typed failure.

Suggested failure categories:
- PROVIDER_UNAVAILABLE
- QUOTA_EXHAUSTED
- RATE_LIMITED
- BILLING_REQUIRED
- MODEL_NOT_APPROVED
- PRIVACY_BLOCKED
- TIMEOUT
- INVALID_RESPONSE
- TASK_BUDGET_EXCEEDED

BILLING_REQUIRED, QUOTA_EXHAUSTED and ambiguous billing responses must disable that route for the current reset window. Do not retry aggressively. Never retry a paid route.

Provider adapters must be independently mockable. Unit tests must not call live provider APIs.

## 4. Data protection

Classify task inputs:
- PUBLIC: public documentation, public market data, public repository content;
- INTERNAL: non-secret project code and internal design notes;
- CONFIDENTIAL: private account information, unpublished business data, user-specific financial records;
- SECRET: API keys, tokens, passwords, private keys, seed phrases, recovery codes.

External providers may receive only PUBLIC data by default. INTERNAL data requires provider-specific privacy review and explicit task authorization. CONFIDENTIAL and SECRET data must never be sent to external model providers.

Never include credentials in prompts, source files, fixtures, traces or provider logs. Keep provider keys server-side and use the minimum required scopes. A provider's free tier is not automatically approved for confidential data.

## 5. AI Council and task orchestration

Start with one coordinator and bounded specialist roles:
- MASTER: task planning, delegation and synthesis;
- DEVELOPER: scoped code changes;
- QUANT: research and simulation analysis, never financial authority;
- SECURITY: threat modelling and dependency review;
- QUALITY: independent test and regression review;
- RESEARCH: public technical research;
- DATA: data quality and provenance.

Do not require every task to call every agent. The coordinator selects the smallest useful set to avoid wasting free quotas.

Task states:
- QUEUED
- POLICY_CHECK
- READY
- RUNNING
- BLOCKED
- AWAITING_REVIEW
- SUCCEEDED
- FAILED
- CANCELLED

Every task must record its objective, non-goals, owner, base SHA, branch/worktree, file ownership, permitted tools, data classification, provider allowlist, zero-cost limit, acceptance criteria, tests, timeout, retry limit and stop conditions.

## 6. Repository isolation and owner authority

- One coding task owns one isolated branch/worktree.
- Do not allow two agents to edit the same file concurrently.
- Automated edits must stay within the task's file allowlist.
- Tests, typecheck and build may run automatically.
- A worker may prepare a branch and a draft PR when explicitly included in the task scope.
- No agent may merge, deploy, release, publish, change repository protections or approve its own work.
- Every merge requires the owner's explicit approval.
- No direct edits to main.

The GitHub announcement remains a draft. Do not publish it, open a public discussion or invite external contributors without owner approval.

## 7. Financial and exchange safety

GM AI Collective is an engineering and research assistant, not a financial decision-maker.

- Public market data, deterministic analysis, backtesting and paper trading only.
- Deterministic TypeScript remains the source of truth for fees, sizing, P&L, risk and trade eligibility.
- LLM output must never be treated as executable financial parameters without validation and owner approval.
- Live order placement remains hard-disabled.
- No private order endpoints, withdrawals, transfers, custody, wallet signing or key collection.
- No agent may change risk limits or strategy rules autonomously.
- Clearly label historical, simulated, estimated and live-observed data.

## 8. Reliability and evaluation

Measure each model/agent using:
- task completion rate;
- acceptance rate after independent review;
- test pass rate for code tasks;
- factual/source accuracy for research;
- security findings and false positives;
- latency and quota consumption;
- cost, which must remain EUR 0.00.

Do not rank agents by number of tokens, number of commits, trading P&L from backtests, or unverified claims. Keep reproducible test cases and compare providers on the same task set.

If quality is insufficient, ask for owner direction or mark the task blocked. Do not silently use a paid model.

## 9. Delivery sequence

### Stage A — Policy and contracts
- Encode FREE_ONLY as a central policy.
- Define provider/task/result/failure types.
- Add registry schema and provider eligibility validation.
- Add tests proving non-approved, unknown-cost and paid routes cannot execute.

### Stage B — Mocked gateway
- Implement provider selection and quota accounting against mock adapters.
- Test rate limits, quota exhaustion, billing-required responses, timeout and fallback.
- Verify fallback only selects another APPROVED_FREE model.

### Stage C — First provider
- Select one provider only after checking its official current free plan, data terms, quota and billing requirements.
- Add one adapter with strict request caps and no automatic paid upgrade.
- Keep credentials in server-side environment only.
- Test using mocks first; perform a minimal public/non-sensitive smoke test only if permitted.

### Stage D — Council and review
- Add specialist roles incrementally.
- Require independent review for code and financial research.
- Keep deterministic tests authoritative.

### Stage E — Dashboard and operations
- Show approved providers, eligibility evidence, quota state, blocked tasks, model health and audit trail.
- Provide global pause and per-agent suspension.
- Do not show "free" unless the registry has current evidence.

## 10. Acceptance criteria

The implementation is accepted only when:
- all monetary budgets are hard-coded/configured to EUR 0.00;
- no paid provider or automatic paid fallback can be selected;
- unknown billing status blocks the provider;
- quota exhaustion stops or queues work;
- provider selection is tested with fixtures;
- sensitive data is blocked from external providers by default;
- every task and provider call is auditable;
- agents are isolated by task and branch;
- merge always requires explicit owner approval;
- GitHub announcement remains unpublished;
- live trading and all money-moving operations remain disabled.

Report the exact commit SHA, changed files, tests and CI status. Distinguish implemented behavior from specification or planned work.