# GM AI Collective — Stage C

Status of the first real provider integration. Everything below was checked on
**2026-11-05**. This document distinguishes what is implemented, what is mocked,
what was verified against official sources, and what remains blocked.

Policy in force: **FREE_ONLY, EUR 0.00**. No card, no purchased credit, no
subscription, no automatic top-up, no paid fallback.

## Approved provider and model

| Field | Value |
|---|---|
| Provider | OpenRouter |
| Model | `cohere/north-mini-code:free` |
| Catalogue revision | `cohere/north-mini-code-20260617` |
| State | `APPROVED_FREE` for **PUBLIC** data only |
| Pricing | prompt `0`, completion `0` (no per-request price in the catalogue) |
| Context | 256 000 tokens |
| Free-tier limits | 20 requests/minute, 50 requests/day while lifetime credits purchased are below 10 |
| Overage behaviour | 429 when a limit is reached; 402 when the account balance is negative — never a charge |
| Local guard | 18 requests/minute and 50/day, below the provider limits |

Evidence read on the review date:

- `https://openrouter.ai/api/v1/models` — the `:free` entry exists with
  prompt/completion pricing `0`, context 256 000, `tools` listed in
  `supported_parameters`.
- `https://openrouter.ai/docs/api_reference/limits` — free-variant limits table,
  402 on negative balance (including free models), 429 handling.
- `https://openrouter.ai/docs/guides/routing/model-variants/free` — `:free` is a
  catalogue variant; **a `:free` model listed inside a `models` fallback array can
  fall through to a paid model that is billed**.
- `https://openrouter.ai/docs/features/provider-routing` — `allow_fallbacks` and
  `data_collection: "deny"` semantics.

Consequences encoded in the adapter:

1. Only a model id ending in `:free` is accepted at configuration time, and the
   completion must name **exactly** the configured model: another `:free` variant,
   a paid model or a missing `model` field is an invalid response with no fallback.
2. The request body never contains a `models` array, so no paid fallback can be
   billed. `allow_fallbacks: false` additionally stops provider-level fallback.
3. `data_collection: "deny"` restricts routing to providers that do not collect
   user data; if none is available the request fails instead of downgrading.
4. The approved record is hosted, so `internalDataApproved` stays `false`:
   `CONFIDENTIAL` and `INTERNAL` tasks do not reach it.

## What is implemented

| Component | File | State |
|---|---|---|
| Free-only policy gate | `src/lib/ai/policy.ts` | implemented, tested |
| Contracts and failure codes | `src/lib/ai/types.ts` | implemented, tested |
| Eligibility registry | `src/lib/ai/registry.ts` | implemented, tested |
| Gateway, timeouts, redaction | `src/lib/ai/gateway.ts`, `redact.ts` | implemented, tested |
| OpenRouter adapter | `src/lib/ai/providers/openrouter.ts` | implemented, tested against mocked HTTP |
| SQLite registry/quota/audit | `src/lib/ai/store.ts`, `store-schema.ts` | implemented, tested |
| Persisted quota port | `src/lib/ai/quota-sqlite.ts` | implemented, tested |
| Server-only composition | `src/lib/ai/runtime.ts` | implemented, tested |
| Verified seed records | `src/lib/ai/registry-seed.ts` | implemented, tested |
| HTTP entry point | `src/app/api/ai/route.ts` | implemented, admin-only |
| Request validation and status mapping | `src/lib/ai/http.ts` | implemented, tested |

## HTTP entry point (admin-only)

`POST /api/ai` is the only way the collective is reachable. The route is thin; the
contract lives in `src/lib/ai/http.ts`, which is pure and tested directly.

- **Admin session required**, through the existing `guardedMutation`: httpOnly
  cookie session, same-origin check and 6 requests/minute per user in process.
- **Classification is server-side**: `parseAiRequest` always builds the task with
  `dataClass: "PUBLIC"`. A body containing `dataClass`, `dataClassification`,
  `requestedBudgetEur`, `budget`, `mode`, `provider`, `providerAllowlist`, `model`,
  `modelId`, `messages`, `system`, `tools`, `maxRequests` or `timeoutMs` is rejected
  with 400 — a client cannot even try to downgrade the policy.
- **Budget**: one provider attempt per request, plus 20 requests/day per account
  claimed atomically in SQLite. One account cannot drain the 50/day free quota.
- **Shared minute window**: 18 requests/minute per provider, claimed through
  `AiStore.claimWindow` in `ai_gate` under `BEGIN IMMEDIATE`, so several processes
  cannot each allow 18. The first claim of a window fixes its limit; a later caller
  cannot widen it. The adapter's in-memory limiter remains as defence in depth.
- **PUBLIC attestation required**: every request must carry
  `attestPublicData: true` (JSON boolean). Without it the request is refused with
  400 and nothing is sent. The confirmation states that the text is public and
  contains no INTERNAL/CONFIDENTIAL/SECRET data, credentials, keys or personal
  data. It is an explicit operator responsibility, **not** an automatic detector:
  forcing `dataClass: "PUBLIC"` on the server cannot prove what the copied text
  contains. Each attestation is stored in `ai_attestation` with task id, user id,
  statement version and timestamp, after the daily budget is claimed and before
  the provider call; if the row cannot be written, the prompt is not sent (503).
- **Input ceiling**: prompt ≤ 64 000 characters (≈16k tokens, the approved record's
  input limit); the adapter re-checks the estimate before sending.
- **Body ceiling**: at most 512 KiB, enforced by `readJsonBody` before `JSON.parse`.
  A declared `Content-Length` above the limit is refused with 413 without reading
  the body; a missing or chunked length is still capped while streaming, so an
  unbounded body is never buffered. Invalid `Content-Length`, malformed JSON and
  invalid UTF-8 are 400.
- **Output**: gateway codes map to 400/402/403/422/429/502/503/504 with a safe
  message. Attempts expose provider, model, outcome, duration and usage only — never
  provider detail, keys or stack traces. `Cache-Control: no-store`.
- **Runtime**: `export const runtime = "nodejs"` and `dynamic = "force-dynamic"`;
  no key or `process.env` read in the route itself; the runtime enforces an explicit
  server-only guard and is not imported by any Client Component.

The route stays inert while `GM_AI_OPENROUTER` is not `true`: it answers 503 before
any network call. It is not wired into any page yet, and it is not a public API.

## What is mocked, not live

- **No live smoke test has been executed.** There is no OpenRouter account, no API
  key and no spending authorization in this workspace. Every adapter test uses an
  injected `fetch`; nothing here proves that a real completion succeeds.
- The adapter is inert unless `GM_AI_OPENROUTER=true`, `OPENROUTER_API_KEY` and a
  `:free` model are all present. Without them every task is queued.

## Database migration

Additive and idempotent: **five** new tables, no change to any existing table.

| Table | Purpose |
|---|---|
| `ai_providers` | provider/model identity, revision, state, billing/card/overage flags, evidence URL and check date, limits, capabilities, health |
| `ai_quota` | window start, window length, used counter, limit, cooldown deadline and code |
| `ai_gate` | shared rolling windows (per-minute limits), keyed by caller; separate from the provider daily quota |
| `ai_attestation` | one row per task: who attested the text as PUBLIC, statement version, timestamp; the content itself is not stored |
| `ai_audit` | gateway events (task, provider, model, code, redacted detail) |

`AI_SCHEMA_SQL` is applied by `getDb()` on every start and by `AiStore.migrate()`.
Both use `CREATE ... IF NOT EXISTS`, so a second run is a no-op. Tests run against
temporary files; the production database is never copied or altered by the suite.

Quota spending happens in `AiStore.claim()` inside `BEGIN IMMEDIATE` with a
rollback on error and a 2-second busy retry, so two processes sharing the file
cannot both take the last request. A cooldown is stored on the row, which means a
billing prompt or a rate limit survives a restart instead of being forgotten in
memory. `claimWindow` (the per-minute window) uses the same transaction.

### Deployment boundary: SQLite is not a distributed limiter

`src/lib/paths.ts` resolves the database to `GM_DB_PATH` or `<GM_DATA_DIR>/gm.db`.
`BEGIN IMMEDIATE` makes `claim()` and `claimWindow()` atomic **only among processes
that open the same SQLite file on the same persistent filesystem**. It provides no
coordination between:

- serverless functions (each instance may get its own `/tmp` or ephemeral layer);
- several hosts or containers without a shared, persistent volume;
- replicas whose `GM_DB_PATH` points to different files.

In those topologies each instance would enforce its own 18 requests/minute and its
own 20 requests/day per account, so the free quota could be exceeded even though
every process respects its local limit. The per-process throttle in `guardedMutation`
and the adapter's in-memory limiter do not close this gap either.

Therefore production requires a single shared, persistent SQLite database and the
explicit declaration `GM_AI_SHARED_DB=true`. `parseOpenRouterConfig` refuses to
enable the adapter in production without it, and the route answers 503. If the
hosting cannot provide such a file, the AI must stay disabled in production: no
paid database or hosted queue is introduced to work around it (budget EUR 0.00).

## Enabling it (owner action)

```bash
GM_AI_OPENROUTER=true
OPENROUTER_API_KEY=<server-side only>
GM_AI_OPENROUTER_MODEL=cohere/north-mini-code:free
# Production only: the SQLite file must be shared and persistent across instances.
GM_AI_SHARED_DB=true
```

Before enabling, re-check the four evidence URLs above: if any of them changed,
set the record to `REVIEW_REQUIRED` (via `saveProvider`) and leave the adapter off.
`seedProvider` never overwrites an existing row, so a reviewed state is not reset
by a restart.

## Verification on this branch

| Command | Result |
|---|---|
| `npm ci` | clean |
| `npm run typecheck` | exit 0 |
| `npm test` | 114/114 passed, AI tests included |
| `npm run build` | exit 0 |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |

Dedicated tests: adapter mapping and payload shape, strict model identity
(approved, other `:free`, paid, missing), migration idempotency, provider
round-trip, non-destructive seeding, quota exhaustion, restart persistence,
multi-process claim concurrency, gateway + persisted ledger, privacy refusals,
credential redaction, runtime opt-in, the production shared-database gate,
mandatory PUBLIC attestation (missing, false, non-boolean) with persistence and
immutability, HTTP body ceiling (declared, chunked, malformed, invalid UTF-8),
and the financial boundary (no order, wallet, credential or withdrawal path,
single networked module, live hard stop).

## Still open

- A live smoke test on PUBLIC text, if and when the owner provides a key. It is
  optional and must not use real user or financial data.
- Whether the Free Models Router (`openrouter/free`) should ever be approved. It
  is seeded as `PENDING_REVIEW` because its composition can change without a
  record revision.
- Whether a model change requires a new review date. Current rule: yes — the
  record carries the pinned revision, and a different model id is a different row.
- Wiring the collective into a product surface. The runtime is server-only and no
  page or route imports it yet; the existing `/intelligence` page still uses the
  deterministic `ai/intelligence.ts` generator.
