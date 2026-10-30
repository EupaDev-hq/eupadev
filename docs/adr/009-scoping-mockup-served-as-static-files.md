---
adr: 009
title: Scoping mock-up served as static files
status: accepted
date: 2026-10-14
decision-makers: Ilan
supersedes:
related: [ADR-005]
check: planned
---
## Context
At scoping, an agent produces a mock-up (HTML pages on the design system,
without a back end) on an agent branch, redone at each correction, which
the requester opens in their company browser. Publishing it as an image
would give write access to the registry to a pipeline that runs agent code
("poisoned pipeline"). This code is hostile by principle (fake login
screen, reading of the storage). Verified on 2026-10-13: the CSP `sandbox`
without `allow-same-origin` gives an opaque origin; no directive of a page
bounds its own navigation, but the `frame-src` of the page that
**contains** a frame blocks any navigation of that frame to another origin
(measured in Chromium and Firefox; outside a frame, the page navigates
freely); the `Sec-Fetch-Dest` header set by the browser says whether a page
is requested for a frame (`iframe`) or as the main page (`document`).
Sources: `docs/reflexions/recherche-2026-10-13/recherche-decisions-B.md`
(decision 4), `docs/reflexions/2026-10-13-adr-details.md` (measurements,
countermeasure).

## Decision
Serve the scoping mock-up as static files of the scoping commit, without
building or publishing an image, under a single host name, isolated in the
browser by the CSP.
- **Source**: the engine reads the commit's archive through the forge's API
  and passes it, with its sha256, to the deployment script of the CI VM
  (forced SSH command), which re-verifies the digest. No new right.
- **Extraction** (EupaDev code): whole archive refused, before any
  write, for a symbolic or hard link, a special file, an absolute or `..`
  path, or beyond the adjustable caps (default 50 MB, 2,000 files); only the
  agreed subdirectory, without the original permissions, into a fresh
  directory renamed in place if everything succeeds.
- **Addresses**: `mockup.<domain>/<digest>/` (ordinary certificate), and
  one alias per cycle `mockup.<domain>/<tool>-<cycle>/` to the latest
  version. Caddy `file_server`, a single block, without reload.
- **CSP of the pages**: `sandbox allow-scripts allow-forms; default-src 'self';
  connect-src 'none'; form-action 'none'; frame-ancestors 'self'` (neither
  `allow-same-origin`, nor `allow-top-navigation`, nor `allow-popups`). No
  cookie on `mockup.<domain>` nor on the parent domain.
- **Frame page** of EupaDev: banner "Mock-up — fictitious data" set by
  the server, the agent's pages below it in an `iframe sandbox`, and
  `frame-src 'self'` in its CSP.
- **Pages served only in the frame**: a mock-up page is served only if
  `Sec-Fetch-Dest` is `iframe`; a top-level navigation (`document`: new
  tab, copied address) or a request without the header is redirected to the
  frame page. The resources loaded by a page (script, style, image, font)
  remain served.
- **Removal** of the directory and the alias of a finished cycle. **No
  promotion**: the mock-up is replaced by the image of the main branch.

## Rejected alternatives
- Image published outside the main branch — write access to the registry
  for agent code, a second publication, a Node server for HTML.
- Pipeline artefact — read right on the pipelines, and nothing to build
  (front end without a build step).
- Preview platform (Coolify, Codeberg Pages) — one more platform; Docker
  socket; EUPL and end of life.
- One subdomain per mock-up — wildcard certificate and DNS at each client,
  whereas the opaque origin already isolates each page.
- Banner inserted into the pages — the agent could hide it.
- Deleting the links after extraction — already created and followed in
  the meantime.

## Consequences
- Nothing of the agent executed server-side, no extra image or right, no
  back end shown (wanted). The agent's JavaScript runs on the requester's
  side: the CSP is indispensable. Navigation, form, request and resource
  loading towards the outside are closed in the frame; unmeasured side
  channels remain (WebRTC, DNS prefetching).
- **Exit from the frame closed by `Sec-Fetch-Dest`**: a page opened alone,
  which could navigate freely, is no longer served. **Limit**: a browser
  that would not send the header sees the mock-up refused (safe by default,
  mock-up inaccessible); a client that forges the header gets the page,
  without risk (nothing secret, no input from the requester).
- Measured in Chromium and Firefox only (Safari not measured). Relative
  links and resources mandatory (served under `/<digest>/`), imposed on the
  scoping agent. Monitoring removes the mock-ups of finished cycles.
- If the tools' front end one day requires a build step, the decision is to
  be revisited (the pipeline artefact becomes the lead again).

## Verification
Real tests in the lab, replayed by a `verify-*` workflow, with the real
deployer, will prove that: two mock-ups under two paths, without reloading
Caddy, do not read each other's storage; the alias designates the latest
version; a booby-trapped archive (links, special file, `../`, absolute,
caps) or one with a wrong digest is refused without writing anything;
`document.cookie`, `localStorage`, external `fetch`, window and navigation
of the main page are blocked; a fake login form sends nothing; a page in
the frame that navigates to another origin (`location.href`, link,
`meta refresh`) is blocked with no request received on the other side, in
Chromium and Firefox; a mock-up page requested as the main page, or without
`Sec-Fetch-Dest`, is redirected to the frame page; the banner resists an
attempt to hide it; the same digest redeployed changes nothing, and the
digest reported as served is that of the directory actually in place.
