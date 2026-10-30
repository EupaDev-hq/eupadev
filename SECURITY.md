# Security policy

EupaDev builds and deploys software inside an organisation's network, so a
flaw in it can reach every tool it produced. Reports are welcome and taken
seriously.

## Reporting a vulnerability

**Do not open a public issue.** Use one of these private channels:

1. **GitHub private reporting** (preferred): the **Security** tab of this
   repository, then **Report a vulnerability**.
2. **Email**: security@eupadev.org.

Please include what is affected (engine, template, core, infra recipes),
the commit, the steps to reproduce, and the impact you expect. One
vulnerability per report.

## What happens next

| Step | Target |
|---|---|
| Acknowledgement | within 7 days |
| Triage (confirmed or not, severity) | within 14 days |
| Fix and disclosure | coordinated with you, within 90 days of the report |

A confirmed vulnerability gets a GitHub security advisory and, when it
qualifies, a CVE, with credit to you unless you prefer otherwise. There is
no bug bounty.

## Reports found with AI or scanners

AI tools and scanners are fine to find issues, but a report must stand on
its own:

- say which tool you used;
- reproduce the issue yourself on a current `main`, and include that
  reproduction — not only the tool's output;
- be able to answer questions about it without the tool.

Unreproduced, bulk or tool-only reports are closed without a detailed
answer; repeated ones may be blocked.

## Scope

In scope: this repository — the engine (`orchestrator/`), the template
copied into each generated tool (`tool-template/`), the shared core
(`core/`), the images (`images/`) and the infrastructure recipes
(`infra/`). Typical examples: an agent escaping its container or its
allowed paths, a way around a human gate, a secret reaching an agent or a
log, a generated tool's security check that can be bypassed.

Not a vulnerability here:

- issues of upstream projects (Gitea, Keycloak, Caddy, Claude Code…):
  report them upstream;
- anything that needs an already compromised administrator account on
  the platform;
- scanner output without a demonstrated impact (missing header on a
  non-sensitive page, outdated version string…);
- denial of service by an authenticated user through heavy but legitimate
  operations.

## Safe harbor

Research done in good faith under this policy is authorised: we will not
take legal action against it. Test only on your own installation, never
on someone else's, do not access or keep data that is not yours, and
give us reasonable time to fix before any disclosure.

## Supported versions

EupaDev is pre-1.0: only the latest commit of `main` is supported. There
are no backports; a fix is a new commit (and release, once there are
releases) with its advisory. Watch the repository's **Security** tab to be
notified.
