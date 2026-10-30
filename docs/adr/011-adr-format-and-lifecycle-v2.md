---
adr: 011
title: ADR format and lifecycle, v2
status: superseded by ADR-026
date: 2026-10-13
decision-makers: Ilan
supersedes: ADR-000
related:
check: in-place
---
## Context
An ADR (Architecture Decision Record) records a platform decision: what,
when, why, what was set aside. It is worth something only if it is not
rewritten afterwards; hence ADR-000's rule: an accepted ADR no longer
changes, it is superseded by a new one. Two critical reviews, on
2026-10-13, showed its flaws: ADRs that point elsewhere instead of
explaining (wrong the day the source changes); progress status in the body,
which becomes wrong once frozen, with no way to see whether the promised
check exists; an ambiguous date on a proposed ADR, editable to postpone the
30-day alert; proposals that linger, but a check that would punish an
unrelated PR; an incomplete check (`related` editable, superseding ADR
never accepted, "#" that truncated a value, force-push on the main branch
compared with itself). The repository, private and free of charge until its
publication, has no branch protection: only the CI, after the push, can
report. Detail:
`docs/reflexions/2026-10-13-adr-details.md`.

## Decision
Each EupaDev platform decision is a self-contained and immutable ADR
in `docs/adr/`, under the following rules.
- **Place**: `docs/adr/NNN-kebab-title.md`, `NNN` sequential on 3 digits,
  never reused, file never renamed. Platform decisions only (a generated
  tool has its `docs/DECISIONS.md`).
- **Format**: flat frontmatter and the sections of `docs/adr/template.md`
  (Context, Decision, Rejected alternatives, Consequences, Verification;
  **Rejection**, optional, written in the commit that rejects). A
  superseded ADR gets no section. Frontmatter comments only at the start of
  a line.
- **Self-contained and short**: decision, context and reasons written in
  the ADR, in about one page; a note may be cited as a source and hold the
  detail (measures, quotes), never serve as the explanation ("see §…").
- **No progress in the body** ("done on…", "to date", blockers): the
  Verification describes the mechanism, in the future tense if it does not
  exist yet; progress lives in `ROADMAP.md`.
- **`check`**: `in-place`, `partial`, `planned` or `none`; mandatory, the
  only field that still changes after acceptance. **Declarative**: the CI
  checks its presence and value, human review its truth. Written only in
  the ADR, shown by the registry, not repeated in `ROADMAP.md`.
- **Date** = date of the decision: empty while `proposed`, filled at
  acceptance or rejection, never in the future.
- **Statuses**: `proposed` → `accepted` or `rejected`; `accepted` →
  `superseded by ADR-NNN` or `withdrawn`.
- **Acceptance**: a decision-maker of `decision-makers` reviews the ADR
  (self-containment, no progress, honest verification) then accepts it in a
  dedicated commit "Accept ADR-NNN" that changes only the status and the
  date.
- **No lingering proposal**: an ADR `proposed` for more than 30 days,
  counted from the commit that adds the file, is reported by a single issue
  kept by a weekly workflow; no PR is blocked.
- **Immutability**: outside `proposed`, title and body frozen (typos
  included), and so are `adr`, `date`, `decision-makers`, `supersedes`,
  `related`; only the status (transitions above) and `check` change. A
  `proposed` ADR changes freely, except its file name.
- **Supersession**: Y declares `supersedes: ADR-X`; X becomes
  `superseded by ADR-Y` only if Y is accepted, in the same commit.
- **Never deleted**; **registry** generated in `ROADMAP.md` between
  `<!-- adr-registry:start -->` and `<!-- adr-registry:end -->`
  (`verify-adr.py --write`), never written by hand.
- **Immediate application**: the CI applies this rule as soon as it reaches
  the main branch, before this ADR is accepted (otherwise the ADRs in
  progress would have no guard-rail); if rejected, it would bring the check
  back to ADR-000.

## Rejected alternatives
- Correct ADR-000 in place — it is accepted, hence frozen by its own rule.
- Tolerate "minimal corrections" — grey area ("now" → "not"); only the
  strict rule can be checked without judgement.
- Progress in the body — it changes, the ADR does not: one of the two lies.
- `check` copied into `ROADMAP.md`, or verified against the repository —
  two copies that prove only that they agree, or a second description per
  ADR.
- Dating a proposed ADR, or counting the 30 days from the author date
  (`%as`) — both can be set freely and postpone the alert.
- Failing PRs after 30 days — punishes an unrelated PR; with no limit at
  all, nothing is ever decided (30 days is a choice).
- `related` free after acceptance — the new link goes in the recent ADR.
- adr-tools, log4brains — no release since 2018 and 2024, none refuses the
  modification of an accepted ADR.

## Consequences
- Changing one's mind costs a new ADR: wanted. A typo stays; if it makes
  the decision ambiguous, it calls for a superseding ADR.
- An ADR can be read on its own and stays correct when the roadmap changes;
  its sourced detail is in a note, which can evolve without it.
- The registry shows missing checks (`planned`, `partial`), but **`check`
  can be wrong without the CI seeing it**: only review, at acceptance and
  at each change of the field, catches it.
- An ADR written after the fact arrives directly `accepted` or `rejected`,
  dated.
- The proposals issue is a reminder (up to a week late), not a constraint.
  A branch rebased before merging restarts from the rebase date; on the
  main branch, the date no longer moves.
- **"Refused" means "CI red"** while the repository has no branch
  protection: a push that changes an accepted ADR, or whose previous commit
  cannot be found, is made then reported, and must be undone. The
  protections, at publication, will make the refusal effective.

## Verification
`.github/scripts/verify-adr.py`, tested by `test_verify_adr.py` and run
by `.github/workflows/adr.yml` on every push and PR that touches an ADR,
`ROADMAP.md` or the check, compares the tree with the base commit (PR base,
else the push's previous commit, else the fork point from the main branch;
on the main branch, base not found = CI red). It fails the CI on: a deleted
or renamed ADR; outside `proposed`, a changed frozen field, title or body,
or a forbidden status transition; a duplicate number or one that differs
from the file name, an unknown status; a date on a `proposed` ADR, or a
missing, malformed or future one elsewhere; an unknown `check`, or a
missing one on a proposed, new or leaving-`proposed` ADR; an inconsistent
supersession (no `supersedes` on the other side, superseding ADR `proposed`
or `rejected`, old one not marked); a registry that differs from the
generated one.
`.github/workflows/adr-proposals.yml`, weekly and manual, calls
`verify-adr.py --proposals` and opens, updates or closes the single issue,
with a token limited to `issues: write`. Not mechanically checkable:
self-containment, the absence of progress, the truth of `check`, the
progress table of `ROADMAP.md` and the review before acceptance (the
"Accept ADR-NNN" commit shows who and when, not that the review happened).
