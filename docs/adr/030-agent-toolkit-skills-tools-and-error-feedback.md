---
adr: 030
title: Agent toolkit, the real error of a red CI given to the next round, read-only Bash for the reading roles, state words refused
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-018, ADR-020, ADR-021, ADR-027]
check: planned
---
## Context
Every role agent runs Claude Code headless, `claude --bare --restricted -p`
(`orchestrator/src/external/claude-engine.ts`), with `--tools` naming
what exists: `Bash,Read,Edit` for the code roles, `Bash,Read` for the
reviewers (Bash reduced to Claude Code's read-only set under `dontAsk`,
ADR-020), `Read` alone for `overlap` and `diagnosis` (`READ_TOOLS`). What
a role knows is its instructions, read from the engine image (ADR-018),
and its task file, `task.md`, with the deviations of the previous round.

Cycle 9 of the lab (2026-11-04) showed three gaps. The contract agent
wrote YAML the core's strict validator refused when the tool started, in
the `image` job of the CI; the hardening round that followed got the
deviation `ci:image` and nothing else, because the engine turns a red job
into `ci:<check>` and reads a job's details for two jobs only
(`acceptance` failures, `analysis` SARIF; `toolCycle.ts`,
`pipelineDeviations`): the builder could not know what to fix. Since
ADR-027, the forge watcher keeps the tail of every red job's log
(`logTail()` of `gitea-forge.ts`: the last 40 non-empty lines, colours,
timestamps and control characters removed, each cut at 300 characters,
`LOG_TAIL`), stored in `pipeline_results.details.log_tail` and read by the
diagnosis alone; the diagnosis, with `Read` only, cannot `grep` the clone
it is asked about. And the scoping agent told the requester the mock-up
was "approved" when the requester had written "Mockup is good" and clicked
nothing: the refused-words check (`agent-engine/jargon.ts`, `jargon.words`
of `lang/*.json`) catches technical words, not words that claim an engine
state, and nothing else on the engine does.

## Decision
Three small changes, each reusing a mechanism the engine already has.
- **The real error of a red CI goes to the next round.** The log tail the
  watcher already stores for every red job (ADR-027: `logTail()`,
  `details.log_tail`, 40 lines of 300 characters, one rule, no second
  size) is written in the next hardening round's `task.md`, as data, under
  the `ci:<check>` or `preview:<check>` deviation it belongs to, for the
  code roles of that round. Nothing new is fetched or stored; a check
  without a tail reads as today.
- **Read-only Bash for every reading role.** `READ_TOOLS` disappears:
  `overlap` and `diagnosis` get the reviewers' list, `Bash,Read` without
  permission (ADR-020: Bash reduced to the read-only set, writes refused
  by the harness and discarded by the launcher). The diagnosis can `grep`
  the contract and `git log` its clone instead of guessing; `overlap` runs
  in an empty folder and gains nothing but one list fewer.
- **State words belong to the engine.** A second refused-words list,
  `state.words` in `lang/*.json` (approved, validated, accepted, sent,
  deployed, merged, published, and their French forms), checked by the
  same whole-word mechanism as `jargon.words` on every text an agent
  writes for the requester (`requester_message` of the scoping role); a
  match fails the task with the word as reason, like a jargon word, and
  the scoping failure counters count it. The instructions say what to
  write instead: what the requester can do next (the button, the link),
  never what the engine has done.

## Rejected alternatives
- A second size for the tail given to the builder (80 lines, 8 KiB) —
  two bounds for one text; the watcher's bound (ADR-027) is what the
  diagnosis reads and is enough for a developer's first look.
- Giving the builder the whole job log — unbounded, and the output of
  dependencies and tools is text an attacker may shape; a bounded tail
  given as data is what a developer reads first anyway.
- Letting the agent fetch the log from the forge — the agent containers
  cannot reach the forge, by design (ADR-016).
- A model that judges whether a message claims an engine state — paid and
  not reproducible; a word list is a reviewed change and a unit test, like
  `jargon.words`.
- Deferred, **role skills** (Markdown know-how files in the engine image,
  read on demand, or loaded natively by `Skill`) — the native loading is
  untested under `--bare --restricted` (whether `Skill` survives
  `--restricted` and `--tools` is not documented), and an explicit read
  from `/tmp/task` is an untested second path; to be decided after a trial
  in the agent image's CI, in its own ADR.
- Deferred, **an agent eval bench** replaying real task archives by hand
  and graded by code — to be merged later with the diagnosis regression
  cases ADR-027 adds per blocked cycle, so that one bench holds both.
- Dropping `--bare` so that skills and CLAUDE.md are discovered — the
  discovery would read the tool's clone, which an agent writes;
  `--bare --restricted` is the cage ADR-018 measured.

## Consequences
A red CI tells the next round what failed, with the text the diagnosis
already reads; the diagnosis reads the clone instead of guessing; a
requester reads what to do, never a state the engine has not reached. The
cost: a few hundred input tokens per tail in a builder's task; two tool
lists instead of three; a new word list to keep in two languages, with
the false refusals of a word used innocently (a scoping task sent back
once with the word as reason). Limits accepted: a log tail is text the
agent reads as data and may still misread; the state-word list catches
the words it knows; the knowledge gap of the contract agent (YAML the
strict validator refuses) is not closed by this ADR.

## Verification
The engine's CI will check: through `tests/claude-engine.test.ts`, that
`roleOptions` returns `Bash,Read` without permission for `overlap`,
`diagnosis` and the reviewers and `Bash,Read,Edit` for the code roles;
through the Gherkin scenarios of `orchestrator/features/hardening-review.feature`,
with the fake engine, that the round after a red `image` job has the
watcher's log tail under `ci:image` in the builder's `task.md`, bounded as
`LOG_TAIL` says, and that a red job without a tail leaves the deviation
alone; through `orchestrator/features/scoping.feature`, that a
`requester_message` holding "approved" sends the scoping task back with
that word as reason and counts in the scoping failures; through
`tests/a-r6.test.ts`, the state-word list in both languages; through
`tests/mutations/mutations.ts`, a mutation killed by each of these tests.
The agent image's CI (`images/agent/check`) will replay the generated
command line with the two tool lists. Not mechanically checkable: the
choice of state words, and whether a builder reads the tail well.
