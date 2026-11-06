---
name: gm-crypto-risk-review
description: Review or change GM Crypto Ecosystem trading strategies, arbitrage calculations, exchange adapters, fee models, paper trading, and risk controls. Use whenever code could change a signal, expected profit, position size, or order-related behavior.
---

# GM Crypto Risk Review

## Before editing
1. Read root `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/PHASES.md`, and `docs/RELEASE_CHECKLIST.md`.
2. Identify whether the change concerns the multi-venue arbitrage engine or the separate BTC asymmetric strategy. Keep their inputs, fees, assumptions, and state isolated.
3. Inspect open PRs and branch history. Do not overwrite work in progress.

## Non-negotiable safety
- Keep live order placement hard-disabled. Do not implement or call private order endpoints.
- Never add withdrawal, transfer, custody, seed phrase, or private-key features.
- Use public market data and paper trading only unless a separately reviewed scope explicitly changes this policy.
- Unknown fee, network cost, minimum size, precision, regional eligibility, stale data, incomplete depth, or uncertain fill must make the signal non-executable.
- Never assume a fee is zero because it is missing. Show fee source, confidence, and checked date.
- Keep USD, EUR, USDT, and USDC distinct. Never compare unlike quote currencies without an explicit, timestamped conversion model.
- Do not claim profitability, guaranteed returns, or execution certainty.

## Calculation review
- Recompute net P&L from depth-weighted fills, both taker fees where applicable, slippage, safety buffer, and transfer/network cost exactly once.
- Validate partial fills, zero/negative values, non-finite inputs, precision/minimum-order boundaries, stale timestamps, and insufficient liquidity.
- Check fee gross-up algebra against a direct net-proceeds calculation.
- Ensure sizing is bounded by available depth and configured risk limits.
- Inject time in deterministic core functions and test edge cases.

## Required validation
Run `npm run typecheck`, `npm test`, and `npm run build`. Add regression tests before changing financial behavior. Report exactly which commands ran and their actual outcomes; never state that tests passed if they were not executed.

## Output
Summarize changed files, assumptions, risks, tests, and any unresolved decision requiring owner confirmation. Clearly label simulated, unverified, and pending behavior.
