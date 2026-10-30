---
paths:
  - "api/**"
  - "web/**"
---

# Security rules (code)

The core enforces, from the contract: OIDC sessions and their cookie,
`x-roles`, closed validation, CSRF (`Sec-Fetch-Site` and a static header),
rate limits, security headers, problem+json errors, static files and upload
types. Your part is what the contract cannot say.

## Authentication and sessions
- `x-roles` says who may call an operation, never whose rows it touches: that is the handler's job.
- No login form, test bypass or test-only route: none exists, not even in tests.

## Requests
- Scope every query to the caller in the SQL itself (owner, or the visibility
  rule of the reference tool); out of scope answers 404 like a missing row.
- SQL only through `ctx.db.tx` with parameters; never a query built from text.
- A redirect target is a relative path of this tool. An outbound call goes
  through `ctx.fetch` to a host the contract names.
- No `eval`, `new Function` or shell command built from text; identifiers and tokens from `crypto`.

## Responses
- Every refusal is `throw new Problem(status, CODE, detail)` with a code the
  contract lists; never an error message, stack or database text.
- Logs through `ctx.log`: ids only, no personal data, secret or full body.

## Static files and browser code
- Text reaches the page through `textContent` or the core's render module;
  never `innerHTML` with data, inline script or inline style (the CSP and
  Trusted Types refuse them).
- No third-party key in anything served; a call that needs one goes through an operation.

## Uploads
- Accepted types and size are declared in the contract (`x-max-bytes`); the
  handler decides only who and when. A download is always an attachment.
