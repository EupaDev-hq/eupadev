---
adr: 033
title: Read-only Bash for the reading roles, state words refused in what an agent writes for the requester
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-018, ADR-020, ADR-027, ADR-030]
check: planned
---
## Context
Every role agent runs Claude Code headless, `claude --bare --restricted -p`
(`orchestrator/src/external/claude-engine.ts`), with `--tools` naming
what exists: `Bash,Read,Edit` for the code roles, `Bash,Read` for the
reviewers (Bash reduced to Claude Code's read-only set under `dontAsk`,
ADR-020), `Read` alone for `overlap` and `diagnosis` (`READ_TOOLS`). What
a role knows is its instructions, read from the engine image (ADR-018),
and its task file, `task.md`.

Cycle 9 of the lab (2026-11-04) showed three gaps. The first, a red CI
whose real error never reached the builder, is decided in ADR-030. The
two others: the diagnosis (ADR-027) reads the log tail of a red job, but
with `Read` only it cannot `grep` the clone it is asked about, nor read
its `git log`. And the scoping agent told the requester the mock-up was
"approved" when the requester had written "Mockup is good" and clicked
nothing: the refused-words check (`agent-engine/jargon.ts`, `jargon.words`
of `lang/*.json`) catches technical words, not words that claim an engine
state, and nothing else on the engine does.

## Decision
Two small changes, each reusing a mechanism the engine already has.
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
The diagnosis reads the clone instead of guessing; a requester reads what
to do, never a state the engine has not reached. The cost: two tool lists
instead of three; a new word list to keep in two languages, with the false
refusals of a word used innocently (a scoping task sent back once with the
word as reason). Limit accepted: the state-word list catches the words it
knows.

## Verification
The engine's CI will check: through `tests/claude-engine.test.ts`, that
`roleOptions` returns `Bash,Read` without permission for `overlap`,
`diagnosis` and the reviewers and `Bash,Read,Edit` for the code roles;
through `orchestrator/features/scoping.feature`, that a
`requester_message` holding "approved" sends the scoping task back with
that word as reason and counts in the scoping failures; through
`tests/a-r6.test.ts`, the state-word list in both languages; through
`tests/mutations/mutations.ts`, a mutation killed by each of these tests.
The agent image's CI (`images/agent/check`) will replay the generated
command line with the two tool lists. Not mechanically checkable: the
choice of state words.
