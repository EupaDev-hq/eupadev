---
adr: 030
title: The real error of a red CI, the watcher's log tail, given to the builder of the next round
status: accepted
date: 2026-11-10
decision-makers: Ilan
supersedes:
related: [ADR-018, ADR-021, ADR-027, ADR-033]
check: in-place
---
## Context
Every role agent runs Claude Code headless, `claude --bare --restricted -p`
(`orchestrator/src/external/claude-engine.ts`). What a role knows is its
instructions, read from the engine image (ADR-018), and its task file,
`task.md`, with the deviations of the previous round.

Cycle 9 of the lab (2026-11-04): the contract agent wrote YAML the core's
strict validator refused when the tool started, in the `image` job of the
CI; the hardening round that followed got the deviation `ci:image` and
nothing else, because the engine turns a red job into `ci:<check>` and
reads a job's details for two jobs only (`acceptance` failures, `analysis`
SARIF; `toolCycle.ts`, `pipelineDeviations`): the builder could not know
what to fix, and the faulty comma was found at round 17. Since ADR-027,
the forge watcher keeps the tail of every red job's log (`logTail()` of
`gitea-forge.ts`: the last 40 non-empty lines, colours, timestamps and
control characters removed, each cut at 300 characters, `LOG_TAIL`),
stored in `pipeline_results.details.log_tail` and read by the diagnosis
alone. A job log is text written by the tool's dependencies and checks:
it may carry secrets (registry credentials in a URL, a token in an
environment line) and `api/` stack traces, which the tests role must never
read (ADR-021). The two other gaps cycle 9 showed, a diagnosis without
Bash and a scoping agent that claims an engine state, are decided in
ADR-033.

## Decision
Give the builder of the next hardening round the log tail the watcher
already stores for every red job, as data, under the deviations that job
produced.
- **One tail, the watcher's** (ADR-027: `logTail()`, `details.log_tail`,
  40 lines of 300 characters, one rule, no second size): nothing new is
  fetched or stored; a red check without a tail reads as today, the
  deviation alone.
- **The builder only** (ADR-021: the tests role never reads code, and a
  job log carries `api/` stack traces); the red checks of the last round
  only, each entry naming the check and the deviations it produced
  (`ci:<check>`, `ci:<check>:<test>`, `ci:opengrep:<id>`,
  `preview:<check>`, the evaluation's own mapping).
- **Secrets redacted before anything is written**
  (`hardening/log-feedback.ts`): credentials in a URL, bearer tokens, the
  value of any token/password/secret/key-looking name in `=`, `:` or JSON
  form, private-key blocks.
- **Capped**: the whole `ci_logs` field of a task at 20 KB of JSON, the
  oldest lines dropped first and marked `truncated`; a cap on the task's
  field, not a second tail size.
- **Written as data** inside the JSON block of `task.md`; a fence (three
  backticks) in a log line is neutralised first.

## Rejected alternatives
- A second size for the tail given to the builder (80 lines, 8 KiB) —
  two bounds for one text; the watcher's bound (ADR-027) is what the
  diagnosis reads and is enough for a developer's first look.
- Giving the builder the whole job log — unbounded, and the output of
  dependencies and tools is text an attacker may shape; a bounded tail
  given as data is what a developer reads first anyway.
- Letting the agent fetch the log from the forge — the agent containers
  cannot reach the forge, by design (ADR-016).
- Giving the tail to every code role — the tests role would read the
  code's stack traces, which ADR-021 keeps from it.

## Consequences
A red CI tells the next round what failed, with the text the diagnosis
already reads. The cost: a few hundred input tokens per tail in a
builder's task, and a redaction list to keep. Limits accepted: a log tail
is text the agent reads as data and may still misread; the redaction
catches the shapes it knows; the knowledge gap of the contract agent (YAML
the strict validator refuses) is not closed by this ADR.

## Verification
The engine's CI (`.github/workflows/engine.yml`) checks: through the
scenario "ADR-030" of `orchestrator/features/hardening-review.feature`,
with the fake engine, that the round after a red `image` job has the
watcher's log tail under `ci:image` in the builder's `task.md`, redacted
(URL credentials, bearer token, secret-looking variable), never in the
tests role's task, and that a red job without a tail (`lint`) gets no
entry; through `tests/log-feedback.test.ts`, the redaction (URL
credentials, bearer tokens, secret-looking keys in `=`, `:` and JSON form,
private-key blocks; plain lines untouched), the fence neutralised, and the
cap (the oldest lines of the oldest check first, `truncated`, the newest
check keeps its tail); through `tests/mutations/mutations.ts`, four
mutations killed by these tests (tail withheld, tail given to the tests
role, no redaction, no cap). The bound of the tail itself is the
watcher's and is checked with ADR-027. Not mechanically checkable:
whether a builder reads the tail well, and a secret of a shape the
redaction does not know.
