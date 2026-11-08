---
adr: 027
title: A read-only diagnosis agent runs before the hardening-blocked gate opens
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-018, ADR-020, ADR-021]
check: in-place
---
## Context
The hardening-blocked gate (`gate_hardening_blocked`) opens on a budget
overrun or on an escalation (stagnation, rounds cap, duration). The admin
who decides there is not a developer; the gate shows them the engine's
reason (which deviation, how many rounds, how much spent) and three
buttons: continue with a top-up, clarify, refuse. Cycle 5 of the lab (the
PPE tool, first paid run, 2026-11-02) opened that gate by stagnation at
$30.12 of $40: `tests` blocked at round 1 ($5.30), two reviewers paid to
review a repository the builder had never touched (round 2, $1.39 and
$1.56, "The builder has not built anything"), the builder stopped twice at
its budget cap (rounds 3 and 4, $8.39 and $8.35, 79 and 90 turns) and no
builder branch on the forge. The reason shown ("invalid or missing report
of role builder for 2 rounds") was true and useless to the admin: a top-up
would have paid for the same failure again, and only the maintainer could
read the task reports and conclude that the platform itself was at fault
(a capped task discarded its bundle; fixed since). The gate needs a
verdict in plain words: why it is blocked and which button to press.

Paid cycle 9 (equipment-management, 2026-11-04 to 2026-11-06, $115.83 to
Prod) showed the second half of the problem: the verdict came too late.
Rounds were paid for failures no agent could fix, each seen by the engine
as an ordinary red check: the platform's Preview security checks hit their
own rate limit (429) for five rounds, about $10; pa11y audited the sign-in
redirection mid-navigation and the CI runner's disk was full, one round of
about $2.40 per wrong guess; the contract's YAML broke the image at
start-up, paid until the escalation gate. The engine has no deterministic
signal that tells these apart from a defect of the agents' code: the forge
watcher turns every failed job into a red check, adds a synthetic red
`pipeline` only when a run fails with no red job, and read a job's log for
two checks only (`acceptance`, `analysis`); a task's failure reason is free
text. Reading the red check's log and the round's reports together is what
the diagnosis does; it has to run before the next paid round, not after
three of them.

## Decision
Run one read-only `diagnosis` agent task before the hardening-blocked gate
opens, and show its verdict on the gate; run it also after the first round
failed for a reason the agents did not produce, and stop the cycle on a
platform or unclear-request verdict before the next paid round.
- **Trigger at the gate**: every transition into `gate_hardening_blocked`
  (budget overrun at round entry, escalation at round entry or at
  evaluation). One diagnosis per situation: the last one is reused while
  no hardening task has run since (a gate reopened by the same overrun);
  never one per visit.
- **Trigger at the first failed round**: at the entry of a round (where
  the counters are checked, D15), when the round that just ended holds a
  failure the agents did not produce — a red check of the CI or of the
  Preview pipeline (deviation on `pipeline`), a task that failed without
  being stopped at its cap or refused by the schema (launcher, engine,
  container), or a task `blocked` on an open point. Once per situation:
  never when a `diagnosis` task was created since the first hardening task
  of the first round counted since the last reset of the counters; after
  it, the stagnation rule of D20 applies unchanged.
- **Inputs, as data**: the cycle's tasks (step, role, round, status, cost,
  what the report says, bounded), the deviations per round, the escalation
  reason, the budget, the commits ahead of main on each code role's branch
  read from the forge, the chat, the red checks since the last reset with
  the tail of each job's log (the watcher reads the last 40 non-empty
  lines of every red job, timestamps, colours and control characters
  removed, each line cut at 300 characters, stored in
  `pipeline_results.details.log_tail`; reusable as data for other roles
  if a later decision says so), and a deterministic pre-check computed by
  the engine (a code role stopped at its cap twice with no commit, a role
  that never delivered, a blocked task and its point). The contract is
  read in its clone (main). Like `overlap`, it gets `Read` only (ADR-020:
  no shell); like every role, its instructions come from the engine image
  (ADR-018).
- **Output**: a `diagnosis` field of the common report, validated by the
  schema and read by the engine: `cause` in {`slow_progress`,
  `unclear_request`, `platform_or_impossible`}, a two-to-four-sentence
  explanation for a non-developer, evidence lines, and a recommendation
  that must match the cause (a top-up in USD, the exact question for the
  requester, or neither: refuse and send the report to the EupaDev
  maintainers). A mismatch is "unavailable", never a verdict.
- **Verdict at the first failed round**: `platform_or_impossible` or
  `unclear_request` → `hardening_execution --[guard:escalation]-->
  gate_hardening_blocked` at once, the reason naming the round and the
  verdict's lines; the gate reuses this diagnosis and its buttons are the
  exits (continue, correction, scope change, refuse; the question for the
  requester is in the admin's hands, the machine has no transition from
  the hardening to the requester). `slow_progress`, or no usable verdict:
  the round starts as before.
- **Never a dead end**: a failed, blocked, timed-out or unreadable
  diagnosis adds a "diagnosis unavailable" line and the gate opens with
  the reason alone; at the first failed round, it lets the round start.
- **Cost**: cap $2, 25 turns, 15 minutes, Sonnet; spent by the cycle
  (measures, dashboard) but never counted by the hardening guard-rails
  (budget check, agents' work duration), so that it cannot reopen the
  gate it serves. At most one more task per situation for the first
  failed round.
- **Database**: the `tasks.role` constraint admits `diagnosis` through a
  new migration that keeps the old values.

## Rejected alternatives
- Rules only, no agent — the pre-check names the facts it can compute
  (caps, commits, blocked points); telling an unclear request from an
  impossible one needs the reports and the chat read together, which is
  what the agent does. The pre-check stays, as the facts the agent cites.
- A deterministic stop at the first failed round (red `pipeline` check,
  launcher exceptions) — it fires zero times on cycle 9's three failures,
  which all appeared as red jobs of the template's CI, like a defect of
  the code would.
- A diagnosis at every gate — the other blocked gates (scoping, contract,
  delivery, prod) show a single technical failure the admin can read;
  only the hardening gate aggregates rounds, reports and deviations.
- A diagnosis after every non-compliant round — up to 25 × $2 per scope;
  the first failure the agents did not produce is where the rounds were
  lost, the stagnation rule covers the rest.
- Stopping on `slow_progress` too — a round the agents could win would be
  escalated; the verdict says they are moving.
- Counting the diagnosis in the budget check — with a top-up equal to the
  agent's suggestion, the diagnosis's own cost would reopen the gate.
- Rerunning a failed diagnosis at each reopening — bounded cost wins: one
  attempt per situation, the admin decides with the reason alone.

## Consequences
The admin reads a cause and a recommendation in their words; a platform
defect is sent to the maintainers instead of being paid for again, after
one round instead of three; an open point of the contract is asked after
one round instead of paying reviews of an empty repository. Each blocked
gate costs up to $2 more, and a round failed by the agents' own code may
pay one more $2 task before round 2; the verdict is an agent's opinion, so
the engine checks its form (closed cause, matching recommendation) and
the admin keeps the decision. A wrong verdict costs one decision; the
pre-check lines, deterministic, and the red checks' log tails stay visible
to contradict it. The watcher fetches one more log per red job (bounded
tail).

## Verification
The engine's CI checks: through `tests/diagnosis.test.ts`, on the data of
cycle 5 of the lab, the assembly of the task's data, the pre-check line
naming the builder stopped twice with no commit, the reading of a
`platform_or_impossible` report and its gate line in both languages, the
refusal of a report whose recommendation contradicts its cause, the
trigger of the first failed round (red check, task failed without a cap
or an invalid report, blocked task; never on reviewer findings alone; once
per situation, again after a reset) and the bounded red checks in the
data; through the Gherkin scenarios of `features/hardening-review.feature`
(ADR-027 to ADR-027 septies), with the fake engine, that the diagnosis
runs before the gate opens with the pre-check in its context, that its
verdict reaches the admin's notification, that a failed diagnosis still
opens the gate with the "unavailable" line, that its cost is outside the
budget check, that a gate reopened by the same overrun creates no second
task, that a red Preview check at round 1 followed by a platform verdict
opens the gate before any task of round 2 with the log tail in the
diagnosis's context, that a blocked task at round 1 followed by an
unclear-request verdict does the same with the question, that a
slow-progress verdict lets round 2 start and pays no second early
diagnosis at round 2, and that a failed early diagnosis lets round 2
start; through `tests/instructions.test.ts`, that the role has its
instructions under the word cap; through `tests/gitea-forge.test.ts`, that
the forge counts the commits of each role branch and stores the bounded
log tail of every red job; through `tests/mutations/mutations.ts`
(`ADR027-…`), that each of these rules has a mutation killed by its test.
