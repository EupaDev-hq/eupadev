---
paths:
  - "tests/**"
---

# Test rules

## Tooling and layout
- Unit tests: `node --test` under `tests/unit/`, by the code's owner.
- Acceptance: Playwright and playwright-bdd under `tests/acceptance/`, as in the reference tool.
- Import the kit, `@eupadev/core/kit` (two users, browser); never copy it.
- Gherkin only for behaviour a requester reads.

## Execution
- Against the deployed Preview (`ACCEPTANCE_BASE_URL`); people are found by role in `KIT_REALM_FILE`, never by name.
- Each scenario makes its own data and never deletes Preview data.
- Every page visited passes axe; page errors and CSP violations fail.

## Security scenario catalogue
Generated from the contract by the platform, never by hand:
- **SEC-AUTH** — no session → 401.
- **SEC-ROLE** — least privileged role → 403, nothing written.
- **SEC-VALID** — invalid body or query → 400 `VALIDATION_FAILED`.
- **SEC-MASS** — unknown key → 400.
- **SEC-CSRF** — cross-site write → 403.
- **SEC-HEAD** — security headers, exact values.
- **SEC-COOKIE** — session cookie attributes.
- **SEC-RATE** — limit + 5 in parallel → 429 with `Retry-After`.
- **SEC-ERR** — forced failure → 500, no internals.
- **SEC-STATIC** — source files → 404.
- **SEC-BYPASS** — test markers → 401.
- **SEC-UPLOAD** — wrong, disguised or oversized file → 415 or 413.

Written by the tests role when they apply:
- **SEC-IDOR** — user A on B's row (`kit/two-users.js`) → 404, B unchanged.
- **SEC-URL** — a copied link opened anonymously or by another user → refused.
- **SEC-XSS** — `<img src=x onerror=…>` saved then displayed → never runs.
- **SEC-SQLI** — `' OR '1'='1` in a filter and an id → never 500 nor all rows.
- **SEC-REDIR** — external redirect targets → `/`.
- **SEC-SSRF** — private or unlisted URLs → 400, nothing fetched.
- **SEC-PATH** — traversal names → 400 or 404.
