# EupaDev governance (v2)

Who decides what, and when, around a tool built by the factory. This is a
starting point: every organisation that installs EupaDev adapts the roles,
the thresholds and the timings to its own rules (last section). What the code
enforces regardless is in `docs/architecture.md`.

Status: the orchestrator that carries the gates, guardrails and budgets below
runs on the lab VMs (code, tests and lab checks: `docs/architecture.md`);
until the dashboard and gate pages are built, gates are decided through its
local API. The checks at Gate 1, the budget framing and the decommissioning
below are designed, not built (`ROADMAP.md` §8.3 to §8.8, §8.15). The access
rights of the robot accounts are built and tested.

## Human roles

| Role | Who | Decides |
|---|---|---|
| Requester | Any employee, developer or not. Talks to the scoping agent, tries the mock-up and the Preview. | The scope; whether the Preview matches the need. Never touches code. |
| Business referent | A person appointed by the business side of the organisation. | Gate 1 and Gate 2. |
| IT department | The organisation's IT department. | Kept informed; **veto** on sensitive tools and on tools with the reinforced operating profile. |
| Administrator / product owner | The person or team operating the platform. | Overlap with an existing tool; budget overruns; decommissioning. |
| Security | A security referent, when the organisation has one; otherwise the administrator. | Reads the Preview check results before Gate 2; may veto a digest. |

A tool belongs to a service or a role, never to a named person: a tool owned
by a person does not survive their departure.

**Two hats, read from the sign-in token** (ADR-017). Today the engine knows two
hats, carried as roles of the Keycloak client `eupadev-api` and granted
through groups: `requester` and `admin`. A person is identified by
the stable pair (issuer, subject) of her token, never by her e-mail, which is
only a contact attribute. What each hat may do:

| Action | Who |
|---|---|
| File a request (creation or evolution) | `requester` or `admin`, with a known e-mail address |
| Judge the mock-up or the Preview, abandon, write in the chat | the requester **of that tool** (or an `admin`) |
| Decide at a gate, cancel a cycle | `admin` |
| Approve Gate 2 | an `admin` who is **not** the requester of the tool (four eyes) |

**Four eyes at Gate 2**: the person who asked for the tool (or its latest
evolution) cannot approve its release; the engine refuses it and the database
refuses it again. The only exception is a subject named in the engine
configuration (`FOUR_EYES_EXEMPTION_SUBJECT`, empty by default; used in the
lab, where one person plays every role); every use is written in
`approvals.four_eyes_exemption`, next to the hat used (`approvals.role`).
The business referent, IT and security roles above are not hats yet: they will
come through a new ADR, not through a free-text column.

## Gates

| Gate | When | What is approved | Shown to the approver |
|---|---|---|---|
| Gate 1 | After the first merge into `main`, before the first Preview. **Once per tool.** | The tool's name and its domain name, and the checks below. | Name, requester, owning service, spec summary. |
| Gate 2 | After the Preview checks have run and the requester has accepted the Preview. **Once per release.** | **One specific image digest**, never "the tool". | The digest, the check results recorded against it, the requester's acceptance. |

Checks at Gate 1 (asked by the approver; the engine does not enforce them yet):

- **Sensitive tool?** (HR, payroll, personal data): a sensitive tool gets its
  own VM.
- **Does the tool use AI for an HR purpose?** If so, it is high-risk under the
  EU AI Act.
- **Dependencies on other tools** are declared: a tool calls another only
  through its HTTPS API, behind the reverse proxy, with an OpenAPI contract.
- **Operating profile** (standard / reinforced), re-assessed at each Gate 1.
- **Retention periods** — mandatory question, for every tool (each one
  records who acted): one period per category of personal data, and one for
  the audit (5 years proposed). Fixed by the client with their data
  protection officer (DPO), recorded in the tool's decisions. Without an
  answer, Gate 1 does not pass: no platform default applies silently.

How a gate works: the orchestrator sends an email to notify, the decision is
taken on a dashboard page behind OIDC sign-in (today: the local API with a
Keycloak access token), and the decision is written in the `approvals`
table with the actor (internal identifier, name at the time), the hat used,
the digest and a comment. No reply to
an email is ever parsed. The workflow waits durably: a restart during a
week-long wait loses nothing. After 24 hours without an answer, a reminder is
sent.

Gate 2 approving a digest is what makes the chain trustworthy: what runs in
Production is bit for bit what was checked in Preview.

## What no agent can do

- Merge into `main`, publish an image, deploy, approve a gate.
- Change its own rules, the role prompts, the analysis rules or the CI:
  refused at push time by the forge.
- Write in another role's folders, or in the acceptance tests when it writes
  code: refused at merge by the orchestrator.
- Weaken a test, a rule or a CI step to make it pass; edit a test so it passes.
- Open a new network destination, run a downloaded file, store a secret.
- Decide iterations or budget: it reports `done`, `blocked` or `failed`; the
  orchestrator decides what happens next.
- Grant itself an exception (`nosemgrep`, skipped test, scanner ignore file…):
  CI caps every exception marker with the dated register `.gitea/exceptions.txt`.

The orchestrator cannot either: it never changes `.gitea/` or an exception file
(refused by the forge on every branch), and it drops its admin right on each
tool right after generating it.

## Exceptions validated by a human

A real false positive (or a CVE accepted for a while) blocks the agent and goes
to the gate. If the human accepts it, they push a branch `exception/**` (only
the designated human and the emergency admin may) with one dated line in
`.gitea/exceptions.txt` (or `.trivyignore.yaml`, 30 days at most), open a PR and
merge it themselves: only they can merge a change to a protected file into
`main`. The line expires on its own (one year at most); the forge audit log
records the merge.

## Budget and guardrails

| Guardrail | Rule | Note |
|---|---|---|
| Iteration cap | A maximum number of code / review rounds per cycle (by default 25 rounds in Hardening, 5 attempts in Scoping; provisional values). | Reached: the tool stops, the administrator is alerted. |
| Stagnation | The same gap reported on several consecutive rounds. | Treated like the cap. |
| Timeout | A limit of agent working time per phase (by default 4 hours; provisional). | Waiting for a human does not count. |
| Budget per cycle | A cost ceiling per phase of each cycle (by default $10 for Scoping, $40 for Hardening, contract included; provisional), compared with the **sum of the real costs** recorded per task in the `tasks` table, never a separate counter. | Overrun: human escalation (approve with a top-up, clarify or refuse), never a silent stop. Before the hardening gate opens, a read-only diagnosis agent tells the admin the cause in plain words (slow progress, unclear request, platform problem or impossible request) and what to do (ADR-027); if it fails, the gate opens with the reason alone. |
| Concurrency | At most N agents at once on the platform, and 3 for one tool. | N is configuration, measured on the real machine. |
| Budget per task | The engine itself receives a cost cap for the task. | Native option of the engine. |

**Open decision: how to frame the budget when the scope grows.** The v1
experience was that the ceiling per tool is reached not because of one costly
step, but because the requester adds one story after another, each more
expensive than the last, and the administrator is alerted late, on a tool that
is already far along. The problem is scope growth, not money. Today the engine
applies fixed envelopes per cycle and an escalation gate with a top-up; the
options being weighed:

1. A price announced before each story (small / medium / large, calibrated on
   recorded real costs), with the running total shown in the chat.
2. A cap on stories per version (for example five in the first version); the
   rest goes to a "next version" list that runs through the cycle again.
3. Graded alerts: requester at 50 % and 80 %, administrator at 100 % with the
   cost per story.
4. An organisational choice: show the cost to the requester, or charge it to
   their service.

## After Production

- **Changes and fixes** go through the full cycle again: scoping if the need
  changes, otherwise contract, hardening, review, merge, Preview, Gate 2.
- **Rollback** is a decision of the administrator: redeploy the previous
  release's digest, no rebuild, no agent involved.
- **Decommissioning** (designed, not built: paused until the second real
  tool). The registry records the last real access of each tool
  (from the reverse proxy logs, not the creation date). Without access for
  several weeks: graded reminders to the owning service, then an official
  notice, then a soft quarantine. Any real access resets the counter. Delays
  are parameters of the installation.

## Known errors

A problem met during a real run is kept only in a generic form: symptom, root
cause, the rule added to the agents' domain rules, and the automatic check
(CI, analysis rule, branch protection) that now catches it when one is
possible. The platform does not accumulate anecdotes: a rule that can be
checked mechanically becomes a check, the rest stays short.

## Intellectual property and client data

- The code of a generated tool lives in the organisation's own forge. Nothing
  about it (code, data, conversations, costs) is sent to EupaDev's authors.
- **Each installation keeps its own memory**: its tools, its decisions, its
  known errors, its calibration data. Only generic rules, with no trace of the
  organisation, may be contributed back to the common engine.
- The agent engine is installed and licensed by the organisation (its own
  model API key); EupaDev ships no engine and no model.
- **Claude Code terms.** The organisation installs Claude Code, accepts
  Anthropic's Commercial Terms of Service and authenticates with its own
  credential (Anthropic API key, or its own Amazon Bedrock / Google Vertex AI
  account). The binary is used unmodified. EupaDev's authors never pay
  for, resell or intermediate model usage on the organisation's behalf
  (code.claude.com/docs/en/legal-and-compliance, read 2026-10-16).
- **Where the build data goes.** EupaDev is sovereign on the *running* of
  the tools (they run on the organisation's servers), not on their
  *building*: the request, the specification and the code written by the
  agents are sent to the model provider. With Anthropic's API directly,
  processing may happen outside the EU and data is stored in the US, kept 30
  days by default (zero retention on request), never used for training under
  commercial terms. An organisation that requires EU processing uses Claude
  through Amazon Bedrock (EU inference profiles) or Google Vertex AI (EU
  region), both supported by Claude Code; the cloud provider is then the data
  processor (platform.claude.com, data residency and data retention pages,
  read 2026-10-16). The platform's AI proxy calls the Anthropic API today:
  the other providers are not wired yet.
- The platform embeds no component under a licence that forbids redistribution
  in a product (AGPL, SSPL, BSL); a tool run from the command line in CI is
  acceptable, embedding it is not.
- Secrets never appear in code, logs, commits or reports; CI blocks a push that
  contains one.

## To adapt per organisation

| Item | Default | Where |
|---|---|---|
| Who holds Gate 1 and Gate 2 | the `admin` hat (group of the Keycloak client `eupadev-api`); four eyes at Gate 2 | Keycloak groups; `FOUR_EYES_EXEMPTION_SUBJECT` (lab only) |
| Budget per cycle, iteration cap, timeout | see above | orchestrator configuration |
| Concurrency N | 1 | environment variable |
| Decommissioning delays (not built yet) | several weeks, graded | orchestrator configuration |
| Identity provider | Keycloak (users from its own accounts, LDAP/AD or any OIDC/SAML provider) | configuration, no code change |
| Agent engine | Claude Code | launcher configuration; a second engine is wired on request |
| Mock-up, Preview and Production domains | `<tool>.scoping.<domain>`, `<tool>.preview.<domain>`, `<tool>.<domain>` | engine (`TOOL_DOMAIN`) and deployer configuration |
| Reminder delay for a pending gate | 24 hours | orchestrator configuration |

The Scoping agent may record, per tool, an exception to a platform default
(for example local accounts instead of OIDC) in `docs/DECISIONS.md` of that
tool, which the approver reads in the tool's repository at Gate 1.
