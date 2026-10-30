---
adr: 018
title: Instructions come from the signed image; the repository, the task and the database are data
status: accepted
date: 2026-10-16
decision-makers: Ilan
supersedes:
related: [ADR-006, ADR-013]
check: partial
---
## Context
Each agent task receives instructions (the prompt of its role) and data
(chat, deviations, catalogue, repository). Until 15 October 2026, the
orchestrator passed a one-line sentence as instruction; the agent read its
real prompt in `agents/<role>.md` **of the cloned repository**, prompted by
a fallback sentence of the charter. But everything in that repository may
have been written by an agent in the previous round: a manipulated agent
that rewrites `agents/backend.md` would rewrite the prompt of the following
rounds. The forge's protected files block this path, but that is a
configuration, not a property of the code.
Two measured findings (no-cost trial against the fake upstream server,
Claude Code 2.1.287, note
`docs/reflexions/2026-10-15-note-consignes-agents.md`): under `--bare`
alone, the `env` block of a `.claude/settings.json` written in the clone
diverts the whole session to the address it names, key included
(the vector of CVE-2026-21852); `--restricted` prevents it. And
`.pnpmfile.cjs` is executed by `pnpm install --ignore-scripts`. The
`overlap` role runs before the tool's repository exists; it has no
instruction source in a clone.
External sources converge: OWASP LLM01 (separate and flag untrusted
content), Beurer-Kellner et al. 2025 (instructions come from a trusted
source fixed before any data is read), Meta's rule of two (an agent that
reads untrusted input must not, in addition, change state and access
sensitive data without a check).

## Decision
An agent's instructions come exclusively from the engine's signed image;
everything else is data.
- A role's instructions = `AGENTS.md` + `agents/<role>.md` + the role's
  domain rules, copied from the EupaDev repository into the engine
  image, read at startup (missing file, empty or containing an invisible
  Unicode character = refusal to start), passed as they are to every task;
  the digest recorded per task is that of this text. No prompt refers to a
  file of the repository.
- The cloned repository, the task file and the database are data: the clone
  is read under `--bare --restricted` (no project or user settings, no
  hooks, no CLAUDE.md, no MCP), `dontAsk` for every role, named tools; the
  agent image carries a `managed-settings.json` (root, read-only root)
  generated from the same list of forbidden paths as the launcher.
- The launcher refuses, before any push, every bundle that touches a
  forbidden path, leaves the role's scope, contains a symbolic link, a
  submodule or a file name with a control or invisible character. The
  forge refuses the same list at push time; it is a belt, the launcher is
  the guarantee.
- `overlap` runs without a repository: its catalogue of tools is given to
  it as data; a "plausible" verdict must name a tool of this catalogue,
  otherwise it counts as "to check".
- Free texts that reach this channel (gate comment, chat, file names) are
  refused if they carry an invisible character.

## Rejected alternatives
- Reading the instructions from the tool's repository, protected by the
  forge — a single layer, of configuration; one mistake makes it silent.
- Creating the repository before `overlap` — a repository created then
  archived for each refused request, for a role that needs no file.
- Keeping `bypassPermissions` for the code roles — the docs say it has no
  protection against injection; `--restricted` refuses it; normal work
  runs in `dontAsk` with Bash and Edit allowed.
- `--bare` without `--restricted` — measured: the session goes to the
  address of the clone's `.claude/settings.json`.
- Marking the data (datamarking, Spotlighting) — bypassed by adaptive
  attacks; what is at stake for `overlap` is a verdict a human reviews.

## Consequences
- One version of instructions = one image version: task digests are
  comparable across tools; the `agents/*.md` copies in tool repositories
  now serve only humans.
- Under `--bare`, Claude Code exposes only Bash, Read and Edit: a code role
  creates its files through Bash. If this hinders real work, the fallback is
  `--restricted` without `--bare`, measured sound in the same trial.
- Three lists to keep equal (launcher, agent image, forge): a single
  constant, a test that fails if one diverges; the forge's list is applied
  only at the next Ansible run.
- The harness remains a belt: `node -e "fs.writeFileSync('.claude/…')"`
  passes under `dontAsk`; it is the bundle check that refuses it.

## Verification
Engine tests (`orchestrator/tests/instructions.test.ts`,
`forbidden-paths.test.ts`, `claude-output.test.ts`, `claude-engine.test.ts`
with a fake `claude` and the real Docker, Gherkin scenarios of the features
`launcher` and `entry-overlap`), mutations INSTR-…, OV-…, E4-… killed by
these tests; the engine image's CI checks one instruction file per role;
the agent image's CI replays the command line without network; the trial
against the fake upstream (`images/agent/check/upstream-trial/`) proves,
without a paid call, that no content of the clone reaches the model and
that forbidden paths are refused — it is run by hand, its place in the CI
of the agent image and in `verify-agents.yml` is still to be done. Not
mechanically checkable: the model's respect of the scope and the quality of
the verdicts (promptfoo evals planned).
