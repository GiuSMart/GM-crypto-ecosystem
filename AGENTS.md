# Agent instructions — GM Crypto Ecosystem

## Project context
- Read `README.md`, `docs/ARCHITECTURE.md`, `docs/PHASES.md`, and `docs/RELEASE_CHECKLIST.md` before making architectural or operational changes.
- The app is a Next.js 16 / React 19 / TypeScript platform. The arbitrage engine is intentionally pure TypeScript; SQLite uses Node's built-in `node:sqlite` on Node.js 22+.
- Preserve the existing multi-venue arbitrage engine and the separate BTC asymmetric strategy. Do not merge their assumptions or fee models without explicit tests and documentation.
- Use the smallest focused change. Inspect the current branch, open PRs, and CI status before editing; do not overwrite another agent's work.

## Mandatory financial-safety rules
1. This product is a market-monitoring and simulation platform. **Live order placement must remain impossible** unless the owner explicitly authorizes a separately reviewed future project. In this codebase, keep `executeLiveOrder()` as a hard stop.
2. Never add withdrawal support, private-key/seed-phrase collection, custody, or transfer automation. Wallets remain watch-only.
3. Exchange credentials, when needed for future account-read functionality, must be least-privilege/read-only. Never request trade, withdrawal, transfer, or account-management permissions.
4. Unknown fees, network costs, stale books, incomplete depth, unsupported pairs, and unverified regional availability must fail closed. Never silently substitute zero.
5. Keep paper trading clearly labelled as simulation. Never represent simulated returns as actual results or promise earnings.
6. Do not put secrets, tokens, passwords, private account data, or real customer data in source, fixtures, logs, screenshots, commits, or generated reports.

## Engineering workflow
- Use the installed project scripts: `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
- Add deterministic tests for every change to financial calculations, fee treatment, sizing, risk limits, venue adapters, or state transitions.
- Prefer pure functions for strategy and risk calculations. Inject time and external data rather than using hidden globals in core calculations.
- Validate all external input at API boundaries; enforce authentication, authorization, CSRF protections, rate limits, and tenant scoping on every mutation/read path.
- Keep server-only modules and secrets out of client bundles. Use explicit Node runtime for SQLite-dependent routes.
- Respect exchange rate limits, timeouts, retry-after responses, and source-specific symbol/precision rules. Do not retry non-idempotent operations.
- Pin GitHub Actions to immutable commit SHAs where practical and use least-privilege workflow permissions.
- Update the relevant docs and `.env.example` whenever configuration or operational behavior changes.

## Review checklist
- Does the change preserve fail-closed behavior?
- Are fees, slippage, transfer costs, quote currencies, and timestamps handled without double counting?
- Are tenant boundaries and admin-only operations tested?
- Are errors safe to show and free of secrets?
- Are tests, typecheck, and production build green on the exact commit?
- Does documentation accurately distinguish implemented, simulated, pending, and unavailable features?

## Agent skills
Codex-compatible project skills live in `.agents/skills/`. Read the relevant `SKILL.md` before changing strategy logic or running a security/quality review. Optional Vercel skills are documented in `docs/FREEBUFF_HANDOFF.md`; do not claim they are installed unless the CLI confirms it.
