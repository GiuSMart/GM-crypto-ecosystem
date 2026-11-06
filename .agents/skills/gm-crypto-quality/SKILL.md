---
name: gm-crypto-quality
description: Perform a focused engineering, security, accessibility, and production-readiness review of the GM Crypto Ecosystem Next.js application. Use before completing a feature, preparing a pull request, or handing work to Freebuff.
---

# GM Crypto Quality Gate

## Review scope
- Follow root `AGENTS.md` and the project's architecture and release checklist.
- Apply Vercel React/Next.js performance patterns when changing React components, server rendering, or data fetching.
- Review accessibility, keyboard operation, visible focus, semantic HTML, responsive behavior, form validation, loading/error/empty states, and locale-aware number/date formatting.
- Review API authorization, tenant isolation, CSRF, input validation, rate limits, SSRF boundaries, secure cookies, secret handling, and safe error messages.
- Review dependency and workflow permissions, immutable action pins, CI triggers, and supply-chain changes.

## Process
1. Inspect the exact diff and all affected call sites before editing.
2. Separate confirmed defects from suggestions. Rank findings as Critical, High, Medium, or Low and cite file/line locations.
3. Fix only well-understood issues within the requested scope. Do not perform broad rewrites or dependency upgrades without evidence.
4. Add regression tests for defects and behavior changes.
5. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` when the environment permits. If a command cannot run, state why and leave it pending.
6. Never weaken authentication, risk checks, tenant isolation, CI, or release gates to make a build pass.

## Required report
- Findings grouped by severity.
- Changes made and why.
- Exact validation commands and outcomes.
- Remaining blockers and owner decisions.
- Explicit confirmation that live trading and withdrawals remain disabled.
