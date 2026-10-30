---
adr: 015
title: Domain of the Previews and of the mock-up, order of preference depending on the client
status: accepted
date: 2026-10-14
decision-makers: Ilan
supersedes:
related: [ADR-014, ADR-009]
check: partial
---
## Context
The Previews and the mock-up (ADR-009) serve code written by agents,
which no human has approved yet. The browser files cookies by site
(registrable domain), not by machine: under `preview.company.fr`, a
Preview can set a cookie valid for the whole of `company.fr` (forge,
intranet, company sign-in), and `SameSite` does not prevent it, since
it is the same site ("cookie tossing"). The `__Host-` prefix protects the
cookies that carry it, not those of the domain's other applications. Facts
noted on 2026-10-14:
- GitHub, Vercel, Netlify serve untrusted content under a separate
  registrable domain (GitHub left `github.com` for `github.io` for that
  reason).
- The Public Suffix List refuses internal uses, labs and projects of
  fewer than a few thousand users; an accepted entry takes months, even
  years, to reach the browsers.
- ICANN reserved `.internal` for private use (July 2024): never
  delegated, no public certificate possible; it needs an internal DNS and
  an internal certificate authority.
- An SME without an IT service rarely has an internal DNS or an authority
  installed on its workstations, but can buy a domain in a few minutes; a
  large IT department has the opposite (long purchasing procedure, AD with
  DNS and certificate authority already deployed).
Sources: `docs/reflexions/2026-10-14-note-e5-deployeur.md` (section
"Preview domain").

## Decision
Serve the Previews and the mock-up under a site different from the
company's domain, chosen in this order depending on what the client can
provide.
1. **Separate registrable domain** (default): for example
   `preview-tools.fr`, public wildcard certificates (Let's Encrypt, DNS-01
   challenge through the DNS host's API, no inbound access).
2. **`<name>.internal`**: for a client who cannot buy a domain but has
   an internal DNS and a certificate authority deployed on the
   workstations.
3. **Subdomain of the company's domain** (last resort): remaining risk
   written in the prerequisites sheet and accepted by the client.
- In every case: `__Host-` cookies imposed in the template (ADR-014),
  and the Caddy of the Previews and of the mock-up removes the `Domain`
  attribute from each `Set-Cookie` it relays.
- Prod stays under the company's domain: its code has passed the gates.

## Rejected alternatives
- Public Suffix List — refused for an internal use, uncontrolled propagation.
- `.internal` by default — requires an internal DNS and authority that
  small clients do not have; a bought domain is simpler for them.
- Separate domain required — some IT departments cannot obtain one.
- Same domain without any other measure — a cookie set by a Preview reaches
  the forge and all the company's applications.
- CSP `sandbox` without `allow-same-origin` — breaks local storage and the
  tools' authenticated requests.

## Consequences
- Options 1 and 2: a Preview can no longer touch the cookies of the
  company, of the forge or of Prod; the Previews stay same-site with one
  another, hence `__Host-` kept.
- Option 1: a domain to renew and a DNS API key to keep in a vault; Caddy
  must embed the DNS host's module.
- Option 2: the client's internal authority must be installed on every
  workstation that opens a Preview.
- Option 3: a Preview's JavaScript can still set a cookie on the parent
  domain; the removal of `Domain` by Caddy only covers the cookies sent by
  the server.
- The mock-up and the Previews change base domain: one more variable in
  the installation (`preview_domain`).

## Verification
- The template's tests will refuse a cookie without `__Host-` or with
  `Domain` (Opengrep rule and its test cases).
- A real test of the deployment of a Preview will check that a
  `Set-Cookie` with `Domain` comes out of Caddy without that attribute.
- Not mechanically checkable: the option chosen at the client and the
  written acceptance of the risk for option 3 (review of the signed
  prerequisites sheet).
