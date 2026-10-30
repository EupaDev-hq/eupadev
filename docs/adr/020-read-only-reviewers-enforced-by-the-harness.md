---
adr: 020
title: Read-only reviewers enforced by the harness, with a shell reduced to the read-only set
status: accepted
date: 2026-10-24
decision-makers: Ilan
supersedes:
related: [ADR-018]
check: in-place
---
## Context
The factory's two reviewers (security, quality) received `--tools Read`
only, like the overlap search (`overlap`). Their instructions ask them to
widen a deviation to its whole class and to run "the smallest read command
that could contradict them" (a `grep`): with `Read` only, and without Glob
or Grep under `--bare`, these steps cannot be carried out. The ROADMAP
(E25) says they are "already mounted read-only": that is false. Their
repository is an ordinary, writable clone; what throws their writes away
is the launcher, which fetches no bundle for these roles. Claude Code, in
`--permission-mode dontAsk`, runs without permission only its set of read
commands (`cat`, `grep`, `find`, `git` in read mode…) and refuses
everything else (permissions doc). The critical review feared that this
set reads outside the working directories; the fake-upstream trial of
2026-10-18 (Claude Code 2.1.287, the engine's command line) shows it does
not: `cat /etc/passwd` and `grep` in `~/.claude` are refused, `grep` in
the clone and `cat` in `/tmp/task` pass, a redirection, `node -e` and
`Edit` are refused. The `blockReadsOutsideWorkingDirectories` setting of
the managed settings adds nothing for the reviewers and refuses the
allowed Bash of the code roles as soon as a command names a path outside
the clone. The replacement of this setting, planned by the research, by
the confinement of the command line verified by the trial (`reviewer`
variant) was approved by Ilan on 2026-10-18.
Detail: note
`docs/reflexions/2026-10-18-note-relecteurs-plafonds.md`, research
`docs/reflexions/2026-10-17-recherche-agents.md` §5.

## Decision
Give the reviewers Bash and Read without any permission, so that the
harness reduces their shell to the read set, confined to the working
directories.
- Reviewers: `--tools Bash,Read`, `--allowedTools` limited to reading the
  task data, `dontAsk` like every role.
- `overlap` keeps `Read` only (separate list): no repository, no need to
  search.
- Writes refused by the harness, and thrown away by the launcher if one
  got through: no bundle is fetched for a read-only role.
- Reads confined to the clone and to `/tmp/task` by the engine's command
  line; no `blockReadsOutsideWorkingDirectories` in the managed settings,
  which would hinder the code roles.
- Fallback if the confinement stops holding: this setting passed to the
  reviewers only through `--settings`; failing that, `Read` only and
  instructions stripped of the "widen" and "prove the contrary" steps.

## Rejected alternatives
- `Read` only — the verification steps of the instructions stay impossible
  to carry out, and a reviewer that cannot contradict itself reports more
  false findings.
- `blockReadsOutsideWorkingDirectories` in the managed settings — no
  measured effect on the reviewers, and it refuses
  `cd /tmp/… && pnpm install` or `head /etc/passwd` to the code roles whose
  Bash is allowed (trial).
- Repository made non-writable — the clone is made in the container by the
  agent's user; making it non-writable would need a mount or a different
  owner per role, for a protection the launcher already provides by taking
  no bundle.

## Consequences
The reviewers can search the whole repository and check their findings.
The parser of the read-only set becomes a surface: a flaw that would let a
write through (CVE-2025-66032, fixed in 1.0.93) stays without effect on
the tool, since nothing is pushed, and bounded by gVisor and a container
without secrets; `CLAUDE_CODE_VERSION` must be tracked. The confinement of
reads rests on an observed behaviour of Claude Code, not on a setting: it
is checked again at every version.

## Verification
The fake-upstream trial of the agent image's CI (`reviewer` variant) fails
if a reviewer gets Edit, if a write or a command outside the read-only set
passes, or if a read outside the working directories succeeds; the `code`
variant fails if the allowed Bash of a code role no longer reads outside
the clone. The engine's tests fail if a reviewer's command line is no
longer `--tools Bash,Read` without permission, if `overlap` gets Bash, or
if a reviewer bundle is pushed.
