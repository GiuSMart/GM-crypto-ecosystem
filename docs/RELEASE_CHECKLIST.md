# Production release checklist

This checklist is a launch gate, not a claim that the application is already production-ready. Record evidence for each item and do not enable a feature merely to make a checklist pass.

## 1. Build and supply chain

- [ ] Require the GitHub Actions CI workflow to pass on the exact release commit.
- [ ] Review dependency audit findings; document and resolve high/critical production vulnerabilities.
- [ ] Confirm the deployed Node.js version is supported by the application (Node.js 22 or newer).
- [ ] Build from a clean checkout and deploy an immutable commit or release artifact.
- [ ] Keep deployment secrets out of Git, build logs, client bundles and support tickets.

## 2. Identity, access and tenant isolation

- [ ] Verify registration, login, logout, password change and password-reset procedures end to end.
- [ ] Confirm every customer-facing database query scopes customer data by the authenticated `user_id`.
- [ ] Test that one customer cannot read or mutate another customer's settings, API credentials, paper trades, reports or audit records by changing IDs or request parameters.
- [ ] Verify admin-only routes reject ordinary customer sessions.
- [ ] Confirm session revocation, expiry, account suspension and login throttling work in the deployed environment.
- [ ] Configure secure production cookies and HTTPS at the public ingress.
- [ ] Before onboarding paying customers, commission an independent application security review.

## 3. Secrets, database and recovery

- [ ] Set a strong, unique `GM_ADMIN_PASSWORD` before first production boot; never rely on a generated bootstrap password in production.
- [ ] Set a stable `GM_ENCRYPTION_KEY` from a secret manager. Back it up securely; losing it can make encrypted exchange credentials unrecoverable.
- [ ] Use a persistent, access-controlled data volume for SQLite. Do not deploy the database on an ephemeral filesystem or unsupported network filesystem.
- [ ] Restrict filesystem permissions for the database, WAL files, master key and backups.
- [ ] Configure encrypted backups, retention, off-host storage and a tested restore procedure.
- [ ] Test database migrations and recovery against a copy of production data before release.
- [ ] Define retention and deletion procedures for account data, logs and credentials.

## 4. Worker and operations

- [ ] Deploy exactly one worker replica until a distributed lease/lock is implemented and tested.
- [ ] Confirm web and worker processes use the same persistent database path and compatible SQLite runtime.
- [ ] Keep `GM_WORKER_ENABLED=false` until the worker host, persistent storage, restart policy and monitoring are verified.
- [ ] Add external uptime/worker-heartbeat monitoring and alert routing before describing the service as 24/7.
- [ ] Test graceful shutdown, restart after failure, exchange API timeouts, rate limits and stale market data.
- [ ] Document an operator runbook for incidents, rollback, key rotation and database restore.

## 5. Market-data and paper-trading validation

- [ ] Verify exchange availability and regional eligibility for every supported venue and target customer.
- [ ] Confirm actual account fee tiers manually; never treat unknown fees as zero.
- [ ] Validate order-book depth, minimum order sizes, precision, withdrawal/network fees, transfer availability, latency and slippage assumptions.
- [ ] Run paper trading over a predeclared observation period and retain timestamped evidence.
- [ ] Report gross spread separately from estimated net result; include fees, slippage, transfer costs and safety buffers exactly once.
- [ ] Compare expected and simulated realized results; investigate discrepancies and missing data.
- [ ] Do not market simulated results as actual customer returns or imply that positive historical observations guarantee future profit.

## 6. Payments, privacy and legal review

- [ ] Keep payment processing disabled until a provider, webhook verification, subscription lifecycle, refunds and tax/accounting flows are implemented and tested.
- [ ] Publish reviewed Terms of Service, Privacy Notice, cookie information where applicable, support contacts and cancellation/refund policy.
- [ ] Define controller/processor roles, lawful basis, retention, data-subject request handling and vendor agreements under applicable privacy rules.
- [ ] Obtain qualified Italy/EU legal advice on the exact service model before launch, especially if it provides personalized recommendations, routes or executes orders, holds assets, or presents itself as an investment service.
- [ ] Review consumer, advertising, affiliate-disclosure and financial-promotion claims. Do not promise earnings or guaranteed arbitrage.

## 7. Launch decision

- [ ] Complete a staging acceptance test using separate admin and customer accounts.
- [ ] Verify security headers and HTTPS on the deployed domain.
- [ ] Confirm support escalation, incident contact and rollback owner.
- [ ] Start with a limited invite-only pilot and explicit feedback channel.
- [ ] Record unresolved risks, owner and target date. Block public launch for any unresolved critical security, data-loss, tenant-isolation or legal issue.

## Current project boundaries

The current worker is an executable prototype and is not proof of a deployed 24/7 service. Browser alerts require the authenticated dashboard to remain open and visible. Live order placement and withdrawals remain disabled. This checklist does not authorize enabling them.
