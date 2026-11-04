# Controlled Live Trading Policy

**Selected mode:** controlled live with preventive pre-authorization and strict limits.

**Current status: DISABLED.** This policy document does not enable live trading, create exchange credentials, place orders, or prove that every Revolut X order type is available through REST.

## Operating contract

Agents may propose and prepare orders only within an owner-approved policy. Agents cannot increase limits, add markets, change quote currency, disable the emergency stop, grant final owner approval, or change API permissions. Any failed check blocks the order. No fallback may silently change order type, size, or price.

## Mandatory limits

The owner must configure and approve: quote currency; maximum notional per order; maximum daily realized loss and worst-case loss at stop; maximum aggregate exposure; the effective order and daily-loss caps are always the stricter minimum between policy values and the separately stored live authorization; maximum orders per rolling hour; maximum spread and slippage; maximum order-book age; and allowlisted symbols. Missing, zero, negative, non-finite, stale, or contradictory inputs fail closed.

## Runtime gates

1. Live master switch explicitly enabled by an administrator.
2. Active owner-approved preventive policy.
3. Separate final owner approval after technical verification.
4. Implemented and tested order router and venue adapter.
5. Valid Revolut X credential with trade-only permission and withdrawals disabled.
6. Fresh authenticated balance, active orders, history and fills.
7. Emergency stop inactive.
8. All notional, daily-loss, exposure, frequency, spread, slippage and data-age checks pass.
9. Idempotency, duplicate-order prevention, timeout reconciliation, partial-fill handling and audit log operational.
10. Verified order type and cancellation behavior for the requested execution method.

The existing executeLiveOrder hard stop must remain until every gate is implemented and independently tested. The policy evaluator is a pure pre-trade guard, not an execution authorization.

## TWAP / Revolut X API caveat

The official Revolut X REST Place Order schema currently lists market, limit, conditional and tpsl under order_configuration. TWAP is documented in the Revolut X product/UI and appears in order history/details and cancellation documentation, but the Place Order schema does not document a TWAP submission payload. GM must not claim REST TWAP placement is integrated until the official current contract is verified. Do not emulate TWAP by firing repeated market orders without a separately reviewed implementation and approval.

## Emergency stop

The emergency stop blocks new orders immediately. A cancel request is not proof of cancellation; reconcile open orders and fills after cancellation because venue cancellation may race with execution. Withdrawals, transfers, custody, leverage and margin remain out of scope.

## Rollout

1. Test the deterministic policy guard with synthetic snapshots.
2. Build a read-only Revolut X adapter and verify signatures, balances, fees, active orders, history and fills.
3. Run paper/shadow mode and reconcile decisions against venue data.
4. Implement the order router behind a permanent default-off gate; test idempotency, retries, partial fills, timeouts, rate limits, cancellation and kill switch with mocks.
5. Confirm TWAP support from the official API contract; otherwise leave TWAP disabled.
6. Complete security review, operational runbook, backups, monitoring and CI on the exact commit.
7. Present the complete configuration and test evidence to the owner.
8. Only after separate final owner authorization may an administrator switch live on.

No profit or return is guaranteed. Agents may not change policy. No production deployment, merge or publication is implied.
