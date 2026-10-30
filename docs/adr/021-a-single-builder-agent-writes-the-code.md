---
adr: 021
title: A single builder agent writes the code; tests written first, fresh-context reviewers
status: accepted
date: 2026-10-19
decision-makers: Ilan
supersedes:
related: [ADR-006, ADR-013, ADR-018]
check: planned
---
## Context
A tool's hardening launches three code roles on three branches: `backend`
(`api/`, `db/`), `frontend` (`web/`) and `tests` (`tests/acceptance/`),
each in its own container, without seeing each other; an `integration`
role is planned for merge conflicts but is never launched by the engine
(only the forge operation "integrate" exists). Facts noted on 2026-10-17
on the engine: the task queue has a concurrency of 1 by default, so the
back / front / tests "parallelism" runs serially in list order and saves
no time; the front codes against the shape of the contract, never against
an API that answers, and the first confrontation happens at integration,
reviewed by reviewers who run nothing; the shared files (`package.json`,
lockfile, `README.md`) are written twice, a dependency added on each side
is a conflict on the lockfile; no channel exists between back and front
and no executable oracle decides between them. The sources converge on
three conditions for several writers: independent units by files, a
near-perfect executable oracle, a coordination channel; we only have the
first. Anthropic lists "frontend, backend, tests, each owned by a
different teammate" among the cases for *agent teams*, which assume
teammates who talk to each other and do not run in `-p` mode (ours);
Cognition (April 2026): multi-agent systems work when "writes stay
single-threaded"; the Claude Code best practices: "have one Claude write
tests, then another write code to pass them", "a fresh context improves
code review".
Detail, sources and costing: `docs/reflexions/2026-10-17-recherche-agents.md`
(§2, §3) and `docs/reflexions/2026-10-17-note-constructeur-unique.md`.

## Decision
A single agent, the `builder` role, writes all of the tool's code; the
`tests` role writes the acceptance suite before it, without reading the
code; two fresh-context reviewers review the result.
- **Roles**: `overlap`, `scoping`, `contract`, `tests`, `builder`,
  `security-reviewer`, `quality-reviewer`. The `backend` and `frontend`
  roles disappear, replaced by `builder`; the `integration` role is
  removed (instructions, translation, report schema).
- **Write scopes**, checked by the launcher before the push and by the
  merge with the same definition: `builder` owns `api/`, `db/`, `web/`,
  `public/`, `tests/unit/` and may also write `README.md`, `.env.example`,
  `docs/DECISIONS.md`, `package.json`, `pnpm-lock.yaml`; `tests` owns
  `tests/acceptance/`; `contract`, `scoping` and the reviewers are
  unchanged; the `Dockerfile` belongs to nobody.
- **One hardening round**: `tests` task, then `builder` task (explicit
  order, not an effect of the queue), integration of the two branches,
  reviewers. The `builder` gets the acceptance suite **read-only** in
  `/tmp/task/`, never in its working clone; `tests/acceptance/` stays
  refused to it at push.
- **Relaunch by deviations**: a deviation on a file goes to its owner
  (`api/`, `web/`, `tests/unit/` → `builder`; `tests/acceptance/` →
  `tests`); a relaunched role starts again with a fresh context.
- **Instructions**: `agents/builder.md` merges the back and front prompts;
  the domain rules keep their names (`backend.md` = API rules,
  `frontend.md` = interface rules) and are both included in the
  `builder`'s instructions.
- **Database**: the `CHECK` constraints on the roles admit `builder`
  through a new migration that keeps the old values; the historical rows
  stay readable, none is rewritten.
- **Conflicts**: between `builder` and `tests` they are impossible by
  construction (disjoint scopes); a conflict between a role branch and
  `main` is still handled by the `integration:conflict` deviation, sent
  back to the `builder`.

## Rejected alternatives
- Status quo (back ∥ front ∥ tests) — at concurrency 1 the time gain is
  zero and the front never has an API that answers; the shared files are
  written twice.
- `backend` then `frontend` serially on the same branch — keeps two
  contexts that do not see each other and two prompts to maintain, for the
  same wall-clock time; removes neither the shared files written twice nor
  the lack of an oracle.
- Agent teams (Claude Code teammates) — experimental, disabled by
  default, and "in non-interactive mode with the `-p` flag … Claude doesn't
  spawn teammates": our execution mode.
- Re-splitting by business capability with several builders — requires
  the executable oracle (suite wired into the CI) and a concurrency above
  1, which do not exist yet; a path documented for later.
- Keeping `integration` as a safety net — never launched by the engine,
  the conflicts it targeted (back ↔ front) become impossible; dead weight
  in the instructions and the schema.

## Consequences
- A single agent reads contract, features, mock-up and suite, and writes
  three directories: a longer context, mitigated by the system prompt, the
  fresh-context relaunch and the common core; to be measured before
  tuning.
- The `builder`'s instructions (charter + role + four rules) are about
  3,800 words until they are rewritten for the core: the longest role
  prompt of the platform, accepted as a transitional state.
- The single task cap (15 min / 40 turns / $3) will cut off a `builder`
  that does the work of two roles: per-role caps and the measurement come
  from a separate decision; no real cycle makes sense before that.
- One more migration, the old values remaining admitted: a rollback needs
  only a migration and the previous code.
- Instructions, report schema and the agent image's check change: engine
  image rebuilt and signed, check `images/agent/check/` regenerated.
- The redundancy of roles that never served (`integration`) disappears;
  the `integration:conflict` deviation and the merge of `main` into the
  branch before working cover the remaining risk.

## Verification
The engine's CI (`.github/workflows/engine.yml`) will check: through the
Gherkin scenarios, that a hardening round launches `tests` then `builder`
and never `backend` or `frontend`, and that a deviation on `web/x.js` is
routed to `builder`; through the database tests, that the migration
accepts a `builder` task, refuses an unknown role and leaves a historical
`backend` row readable; through `tests/instructions.test.ts`, that the
loaded instructions cover exactly the engine's roles (fail-closed on a
missing file); through `tests/claude-output.test.ts`, that the schema
embedded in the agent image's check is the template's; through the
mutations, that restoring the fan-out or routing `web/` to `tests` is
detected. The launcher will refuse before the push any file outside the
role's scope, and the merge will apply the same definition of the scope.
Not mechanically checkable: the quality of the code produced by a single
builder compared with two (measured by integration conflicts, rounds
before the first green push and cost per round, reviewed by Ilan).
