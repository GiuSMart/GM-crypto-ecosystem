# Skills Intelligence — read-only core

Deterministic, server-only building blocks for cataloguing and reviewing external Agent Skills.
Nothing here installs, updates, downloads or executes a Skill: a Skill is untrusted instruction
content, and installation always stays a human decision.

## Verified API behaviour (2026-11-04)

Checked against the live `skills.sh` API from this repository, not taken from older notes.

| Endpoint | Response without credentials |
|---|---|
| `GET /api/v1/skills` | `401 authentication_required` |
| `GET /api/v1/skills/curated` | `401 authentication_required` |
| `GET /api/v1/skills/search?q=…` | `401 authentication_required` |
| `GET /api/v1/skills/{source}/{skill}` | `401 authentication_required` |
| `GET /api/v1/skills/audit/{source}/{skill}` | `200`, public JSON |

The 401 body is `{"error":"authentication_required","message":"… Pass a Vercel OIDC token
(Authorization: Bearer <VERCEL_OIDC_TOKEN>) …"}`, and <https://skills.sh/docs/api> documents the
Vercel OIDC flow (token injected per request on a linked Vercel project; 600 requests/minute per
team and project; `429` with `Retry-After`; `503` for temporary unavailability).

This is the **inverse** of what `docs/SKILLS_GOVERNANCE.md` and `docs/FREEBUFF_HANDOFF.md` assume
(public catalogue, authenticated audit). Those documents must be corrected before any catalogue
feature is planned, and the catalogue cannot be read without either a linked Vercel project or
another data source. The audit endpoint is usable today without authentication.

## Implemented

- `src/lib/skills/client.ts` — read-only client:
  - `listSkills({ view, page, perPage, source })` with the documented pagination contract;
  - `searchSkills(query, { owner, limit })`;
  - `getAudits(source, slug)` plus the conservative verdict;
  - token injected per request via a `token()` callback, never cached, logged or echoed;
  - catalogue calls fail fast with `authentication_required` when no token is configured;
  - `401`, `404`, `429` (`Retry-After` in seconds or HTTP date), `502/503` with bounded exponential
    backoff on `503`, and `redirect: "error"` so a 3xx cannot move a request to another host.
- `src/lib/skills/audit.ts` — normalisation and the decision matrix: any `fail`/HIGH/CRITICAL →
  reject; any `warn`/MEDIUM → manual review; pending/unknown/missing → hold; all pass → eligible for
  **source review only**. Unrecognised provider values become `UNKNOWN`, never a pass.
- `src/lib/skills/hash.ts` — `skillContentHash()`: SHA-256 over path, byte length and exact content,
  sorted by path. Rejects empty snapshots, duplicate paths and any path that escapes the snapshot.
- `src/lib/skills/review.ts` — the lifecycle `discovered → metadata_checked → source_review →
  audit_review → approved → installed → monitored` with terminal `rejected`, `quarantined`, `stale`,
  `revoked`. `installed` is unreachable without `approved`, and a changed snapshot hash turns an
  approved/installed/monitored record `stale`.

## Deliberately not implemented

- Catalogue detail (`/skills/{source}/{skill}`) and curated parsing: their response shapes could
  not be verified without a token, and unverified parsing would be guesswork.
- Persistence, admin review UI, background sync and reporting: these need an access-control and
  storage design first.
- Any installation, update or execution path. There is none by design.

## Tests

`tests/skills-review.test.ts` and `tests/skills-client.test.ts` cover the decision matrix, hash
stability and path rejection, lifecycle transitions, stale invalidation, pagination, auth
handling, retry/`Retry-After` behaviour and the public audit path. They use a fake `fetch` and
never touch the network.
