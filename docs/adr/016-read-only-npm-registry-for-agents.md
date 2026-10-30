---
adr: 016
title: Read-only npm registry for agents, Verdaccio mirror
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-005, ADR-007]
check: planned
---
## Context
Agents code in isolated containers on the "agents" VM, with no route to
the Internet except through Smokescreen, a CONNECT proxy with a domain
list, which allows only `registry.npmjs.org` for `pnpm install`. Smokescreen
sees the requested name, not the encrypted content: in that tunnel, a
compromised agent (prompt injection) can publish a package holding code or
data (`npm publish`, with a token it found or an account created for the
occasion), then read it back from anywhere; `unpublish`, `dist-tag` and raw
`PUT` also get through. Since December 2025, npm requires 2FA to publish,
which reduces this risk without cancelling it. OpenAI (Codex cloud) limits
the methods to `GET`, `HEAD`, `OPTIONS`. Moreover, the minimum release age
(`minimumReleaseAge`, 1 day) is a pnpm setting, hence a client one: a
compromised agent can reset it to zero. Yet 1 day is a floor (pnpm 11,
Yarn 4.10, npm 11.10): Dependabot waits 3 days by default, and Shai-Hulud
2.0, published from 21 to 23 November 2025, was only widely reported on
the 24th. Age does not protect against a patient attacker (xz-utils,
event-stream): known malicious packages must also be refused (OpenSSF
S2C2F, ING-3 and SCA-4).
Facts noted on 2026-10-15: Verdaccio (MIT, 6.10.5 of 2026-10-03) is an
npm registry with an upstream cache; a package rule without `publish`
"matches nobody"; a flaw of September 2026 (GHSA-vjgw-2g79-p7w7, fixed in
6.10.1) bypassed these rules. Verdaccio embeds its plugin
`@verdaccio/package-filter` (MIT, young: March 2026), which hides recent
versions and refuses their tarballs, but **fails open**: an error of the
plugin serves the manifest or the tarball unfiltered. A fake
credential-stealing Verdaccio plugin circulated in August 2026. Smokescreen
without a client certificate applies the same rule to all its clients.
Nexus CE offers npm only under the Sonatype EULA, capped; Artifactory OSS
has no npm.
Detail and sources:
`docs/reflexions/2026-10-15-recherche-registre-npm-lecture-seule.md`.

## Decision
Route every npm install of the agents through a read-only Verdaccio mirror
on the agents VM, the only one to reach `registry.npmjs.org`.
- **Mirror**: Verdaccio ≥ 6.10.1, official image pinned by digest,
  version of the embedded `@verdaccio/package-filter` frozen; no plugin
  added, outside the `@verdaccio` scope; scanned and signed like the others.
- **Read-only, two barriers**: a Caddy in front of Verdaccio only lets
  `GET` and `HEAD` through (405 otherwise) and refuses `/-/user/`,
  `/-/v1/login` and the audit; behind it, a single rule `'**'` with
  `access: $all` and `proxy: npmjs`, without `publish` or `unpublish`,
  registration off (`max_users: -1`), web interface and `audit` off.
- **Minimum age imposed by the mirror**: 3 days (`minAgeDays: 3`); an
  urgent fix goes through the plugin's `allow` list, changed only after
  human validation. pnpm keeps its setting at 1 day.
- **Known malicious packages**: `osv-scanner` in CI on the lockfile (OSV
  database, OpenSSF `MAL-` entries) fails the CI.
- **Open filtered mirror**, not a closed list: every new direct
  dependency is checked in CI and reviewed by a human; install scripts
  blocked (`strictDepBuilds`), and a change of `allowBuilds` by an agent
  requires a human review in CI.
- **Network**: the mirror (its Caddy) is attached to each task network
  like the proxies (addressed by IP, `ip_forward=0`); the agent receives
  `npm_config_registry=http://<IP>:4873/` and the IP in `NO_PROXY`.
  `registry.npmjs.org` leaves the list of the agents' Smokescreen; the
  mirror goes out through a second Smokescreen instance, for it alone,
  limited to `registry.npmjs.org` (private IPs refused).
- **Fail closed**: mirror stopped = install impossible, no direct
  fallback; plugin missing or invalid configuration = mirror not started
  or refused by the filtering test, never served without a filter. Cache
  on a Docker volume, never backed up (reproducible).

## Rejected alternatives
- Keeping direct access through Smokescreen — writing to npm stays open.
- Verdaccio's rules alone against writing — they have already been
  bypassed (GHSA-vjgw-2g79-p7w7).
- Age of 1 day at the mirror — market floor, shorter than the detection
  delay of Shai-Hulud 2.0; 7 days would delay fixes too much.
- Closed list of packages — each dependency would require a validation;
  the practice (S2C2F ENF-2, JFrog Curation, Sonatype Firewall) is an open
  mirror filtered by policies.
- Nexus Repository CE — npm outside the free core, EULA, caps.
- Artifactory OSS — without npm, AGPL-3.0.
- Gitea's package registry — no npm upstream cache, on the forge.
- npm-registry-firewall — no release since November 2023.
- TLS interception to filter the methods — a certificate authority in
  every container.
- Prefilled pnpm store, agents offline — no more adding of dependencies.
- Making the mirror go out through the agents' Smokescreen — shared rule:
  the agents would keep access to npm.

## Consequences
- No more writing to npm from the agents; the minimum age no longer
  depends on the client. The cache speeds up repeated installs.
- A version less than 3 days old is unavailable: an urgent fix waits for
  a human validation.
- One more Caddy, service and Smokescreen instance to maintain; a disk
  that grows (no expiry of the tarballs): purge to plan.
- The age filter relies on a young plugin that fails open: only the test
  makes it reliable, to redo at every Verdaccio update.
- A write flaw of Verdaccio would allow poisoning the shared cache; the
  lockfile (`integrity`) protects the versions already locked.
- Very weak channels remain: public download counters, requested names
  seen by npm. Provenance checks depend on what the mirror passes on.

## Verification
`verify-agents.yml` will check in the lab, under runc and runsc:
`pnpm install` of the template through the mirror; 405 answer from the
Caddy to any method other than `GET`/`HEAD`; refusal of `npm publish`,
`unpublish`, `dist-tag`, `deprecate`, `adduser`, raw `PUT` and `DELETE`,
including with a scoped name followed by `/`, and nothing written to the
storage; refusal (407) of a CONNECT to `registry.npmjs.org` by the agents'
Smokescreen; refusal of a version less than 3 days old in the manifest and
on a direct `GET` of its tarball (curl, and
`pnpm install --frozen-lockfile` with a lockfile that names it), cold and
warm cache, even with `minimumReleaseAge=0`; misnamed plugin or invalid
configuration → mirror not started or test failing; refusal by the
mirror's Smokescreen of any other name and of private IPs; install failure
with the mirror stopped. The tools' CI will run `osv-scanner` on the
lockfile and report any change of `allowBuilds`. The image will be pinned
by digest (ADR-005) and scanned by Trivy. Not mechanically checkable: the
absence of any other egress channel to npm, the correctness of the `allow`
list.
