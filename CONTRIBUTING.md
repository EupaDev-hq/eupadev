<div align="right">

🇫🇷 [Lire en français](CONTRIBUTING.fr.md)

</div>

# Contributing to EupaDev

Thanks for considering a contribution. This project is still
**pre-release**: on the lab, a full cycle with a scripted agent (no AI)
runs end to end — forge, CI, gates, signed image, Preview, Prod — but the
dashboard and several pieces are still being built (see
[`docs/architecture.md`](docs/architecture.md) and [`ROADMAP.md`](ROADMAP.md)
§8). Expect things to move.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you open a PR

For anything beyond a typo fix, open an issue first describing the
problem or the change you have in mind. This project has a fairly
opinionated, security-first design (see
[`docs/architecture.md`](docs/architecture.md)
and [`ROADMAP.md`](ROADMAP.md) for the reasoning behind most choices) —
an issue first saves you from writing a PR against a decision that was
already deliberately made a specific way for a documented reason.

## Where the rules actually live

Don't guess conventions from reading existing code alone — this project
has them written down explicitly, and they're meant to be followed
literally, including by the AI agents that use this template:

- [`tool-template/AGENTS.md`](tool-template/AGENTS.md) — the
  agent charter: the Scoping → Contract → Hardening → Review cycle, roles
  and the folders each may write in, protected files, non-negotiable rules.
- [`tool-template/.claude/rules/*.md`](tool-template/.claude/rules/) —
  detailed rules per domain: `backend.md`, `frontend.md`, `security.md`
  (18 security categories), `quality.md` (7 quality axes), `tests.md`.
- [`docs/architecture.md`](docs/architecture.md) —
  how the platform itself is wired (trust model, pipeline, deployment
  contract).
- [`docs/governance.md`](docs/governance.md) —
  roles, gates, lifecycle of a generated tool.

If you're changing a rule in `.claude/rules/`, also update the matching
section of the corresponding read-only review sub-agent in
`.claude/agents/` if the check needs to change — a rule with no matching
check is effectively unenforced.

## Making a change

1. **`tool-template/`** — any rule or convention change here affects
   every tool future generated from this template. Keep `AGENTS.md`
   short (~110 lines) on purpose; detailed reasoning belongs in the
   relevant `.claude/rules/*.md` file, not in `AGENTS.md` itself.
2. Keep comments explaining *why*, not *what* — the code already shows
   what it does.

## Commit messages

No strict format required, but a commit message should explain why a
change was made, not just restate the diff. If a change fixes a real bug
found while testing, say what broke and how it was found — that context
is what makes the project's own checklist items trustworthy later.

## Sign-off (Developer Certificate of Origin)

Every commit must be signed off: `git commit -s` adds the line
`Signed-off-by: Your Name <you@example.org>`, which must match the
commit's author. By signing off you certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):
you wrote the change, or have the right to submit it under the project's
licence. The CI refuses a pull request with a commit that is not signed
off. To fix one: `git commit --amend -s` (last commit) or
`git rebase --signoff main` (all of them), then force-push your branch.

## How this project is built

Most of EupaDev's code is written by an AI coding agent (Claude Code). A
human — the maintainer — decides what to build, reviews every change,
runs it on the lab VMs and signs it off. What makes that trustworthy is
not the agent but the checks around it: the CI (types, tests, mutation
testing, English only, pinned digests, ADR immutability), real runs on
the lab, and an [AI error log](docs/ai-error-log.md) that records every
mistake of the AI that was caught, by what, and what it would have cost.
The maintainer's own commits carry an `Assisted-by:` trailer naming the
model. The rules below apply to everyone, the maintainer included.

## Contributions written with AI

AI assistance is welcome, under the rules we apply to ourselves:

- **Say it**: the pull request's "AI disclosure" names the tool, the model
  and what it did. An `Assisted-by: <tool> <model>` trailer in the commit
  is welcome; a tool is never a `Co-authored-by`.
- **Own it**: you have read, run and understood every line, and you can
  explain it without the tool. The description and your answers to the
  review are written by you.
- **Sign it yourself**: only a human can certify the DCO; a tool never
  signs off.
- **Test it**: the change comes with its tests, as any other.
- **No autonomous agents**: no bot or agent opens issues or pull
  requests, or comments, on its own.
- **Reproduce first**: a bug or vulnerability found by AI is reported only
  once you have reproduced it yourself (see [SECURITY.md](SECURITY.md)).

Undisclosed, bulk or unexplained AI work is closed without discussion.

## Project governance

EupaDev has one maintainer, who reviews and merges every change and
decides the roadmap; the decisions and their reasons are the ADRs of
[`docs/adr/`](docs/adr/). The [Code of Conduct](CODE_OF_CONDUCT.md)
applies everywhere. Help and support: [SUPPORT.md](SUPPORT.md).

## Reporting a security issue

Do not open a public issue: follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree your contribution is licensed under the
project's [Apache 2.0 license](LICENSE).
