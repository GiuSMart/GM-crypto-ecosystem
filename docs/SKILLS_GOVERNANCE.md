# External Agent Skills — governance and security policy

## Purpose

Use skills.sh and the open Agent Skills format to discover reusable capabilities for GM Crypto Ecosystem without allowing third-party instructions or scripts to weaken application security.

Skills are portable instruction packages. They do not create an agent runtime, grant tools, prove correctness, or enforce application security.

## Sources and priority

1. Official Skills published by the technology maker, where available.
2. Maintained upstream repositories with clear ownership and release history.
3. Independent Skills only after additional review.
4. Experimental or unmaintained Skills remain excluded by default.

Official origin is a provenance signal, not a security guarantee. Install count, trending rank and leaderboard position are popularity signals only.

## Discovery API

Base URL: `https://skills.sh/api/v1/`

| Endpoint | Use |
|---|---|
| `GET /skills` | Leaderboard: `all-time`, `trending`, `hot`; paginated |
| `GET /skills?source=owner/repo` | Repository-specific all-time inventory |
| `GET /skills/search?q=...` | Search |
| `GET /skills/curated` | Official first-party Skills |
| `GET /skills/{source}/{skill}` | Full file snapshot and SHA-256 hash when available |
| `GET /skills/audit/{source}/{skill}` | Partner audit results; authenticated access required per documentation |

Use stable `id` values (`{source}/{slug}`) rather than display names. Record `source`, `slug`, `name`, `installs`, `sourceType`, `installUrl`, `url`, `isDuplicate`, snapshot `hash`, file paths, audit providers, statuses, risk levels and `auditedAt`.

Respect cache headers (leaderboard/search approximately 30–60 seconds; detail/curated approximately 5 minutes), pagination, rate-limit headers, 429 `Retry-After`, and 503 exponential backoff. Do not poll continuously.

Try public read-only catalogue endpoints without authentication first. Do not assume every endpoint has identical auth requirements. If audit access needs Vercel OIDC, enable it only for a linked project and obtain a request-scoped token using the documented helper. Never cache a token at module scope, expose it to a browser, print it, or commit it. Never commit `.env.local`.

## Mandatory review before installation

For every proposed Skill:
1. Verify repository owner, source URL, default branch, maintenance and license.
2. Read the complete `SKILL.md` and all referenced files.
3. Inspect scripts, executables, package manifests, dependencies and install hooks.
4. Identify network calls, shell commands, filesystem access, environment-variable access and credential handling.
5. Detect prompt-injection instructions, attempts to override system/project policy, exfiltration, obfuscation and destructive commands.
6. Compare `isDuplicate`, upstream origin and content hash; do not install forks merely to inflate the catalogue.
7. Review compatibility with the actual agent and repository stack.
8. Check all available audit providers and the audit timestamps.
9. Record reviewer, decision, reason, source hash and date.
10. Install only after explicit owner approval; pin the reviewed source/revision where practical.

Downloaded Skill content is untrusted data. It must never be treated as higher-priority policy or executed merely because it was indexed by skills.sh.

## Audit decision matrix

The site may aggregate Gen Agent Trust Hub, Socket, Snyk, Runlayer and ZeroLeaks. Preserve each provider's original result; do not collapse conflicting results into a single optimistic status.

| Condition | Internal decision |
|---|---|
| Any provider reports `fail` | Reject and quarantine |
| Any provider reports HIGH or CRITICAL | Reject and quarantine pending independent remediation/re-audit |
| Any provider reports MEDIUM or `warn` | Manual security review; no automatic installation |
| All available providers pass and risk is NONE/LOW | Eligible for source review, not automatically approved |
| Audit missing, 404 or pending | Unknown; hold for review and do not auto-install |
| Providers disagree | Use the most conservative result and require manual review |

A `pass` is not proof of safety. An audit is a point-in-time signal and can become stale after the source changes. Any changed SHA-256 hash invalidates the previous content review and requires a new review.

## Internal lifecycle

`discovered -> metadata_checked -> source_review -> audit_review -> approved -> installed -> monitored`

Alternative terminal states: `rejected`, `quarantined`, `stale`, `revoked`.

No external Skill should move from discovered to installed automatically. An update is a new review, not a routine blind refresh.

## Recommended initial shortlist

Evaluate, do not blindly install:
- Vercel: `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `next-best-practices`, `ai-sdk`.
- Testing/workflow: `test-driven-development`, `webapp-testing`, `verification-before-completion`, `systematic-debugging`, `using-git-worktrees`, `requesting-code-review`.
- UI: `frontend-design`, `ui-ux-pro-max`, `polish`, `critique` (only if compatible and non-duplicative).
- Official integrations: relevant OpenAI, GitHub, Coinbase, Cloudflare, Sentry or database-maker Skills only where the feature is actually needed.
- Revolut X: `revx-account`, `revx-auth`, `revx-market`, `revx-strategy`, `revx-trading`, `revx-monitor`, `revx-telegram` require upstream source review; authentication/trading Skills are high sensitivity and must not enable private order or transfer functions.
- Marketing Skills are advisory only; no automatic ad spend, publication, fake testimonials or profit guarantees.

Do not install mobile, database, browser automation, Ralph-loop or orchestration frameworks until the matching product requirement exists. Avoid multiple competing tools for the same role.

## CLI policy

- Prefer project-local installation, never global by default.
- Use an explicit list of Skills; do not install `*` or every Skill in a repository.
- Use dry-run where supported and inspect the resulting diff.
- Disable anonymous CLI telemetry with `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` where supported.
- Review and commit the lock/configuration files only when their format and behavior are understood.
- The `experimental_sync` / lockfile flow must remain opt-in until tested in CI; do not add automatic install hooks to `prepare`.
- `skills.sh.json` customizes only the public catalogue page; it does not install or configure Skills.

## Licensing and distribution

Keep upstream license notices when copying or redistributing Skills. Check each repository and any bundled assets/dependencies individually. A public or unlisted Pack is not access-controlled; never put proprietary instructions, credentials, internal risk parameters or confidential data in it. Keep private GM Skills in this private repository or another access-controlled location.

## Audit record fields

At minimum: stable ID, upstream URL, license, duplicate status, compatibility, source hash, audit providers/status/risk/timestamp, review status, reviewer, decision reason, installed version, installation date and last recheck date.
