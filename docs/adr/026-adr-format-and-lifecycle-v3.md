---
adr: 026
title: ADR format and lifecycle, v3
status: accepted
date: 2026-10-28
decision-makers: Ilan
supersedes: ADR-011
related: [ADR-025]
check: planned
---
## Context
An ADR (Architecture Decision Record) records a platform decision: what,
when, why, and what was set aside. It is worth something only if it is not
rewritten afterwards. ADR-011 (accepted 2026-10-13) therefore freezes the
title and body of every ADR that has left the proposed status, typos
included, forbids renaming an ADR file, and is enforced by a CI script
that compares every ADR with the base commit and generates the ADR
registry of `ROADMAP.md`. ADR-011 writes its vocabulary in French:
statuses, the check field and its values, section headings, registry
markers. ADR-025 makes English the original language of the repository,
with a French translation for documents read outside the team, ADRs
included. On 2026-10-28, 22 of the 25 ADRs are written in French and 3 in
English with French statuses and headings; 17 have left the proposed
status and are frozen; 23 file names are French or carry a French word,
and appear in links and in the registry. ADR-011's checker refuses any
change to a frozen title or body and any rename, so a translation needs an
explicit exception; it also dates a proposal by the commit that added the
file without following renames, so a rename would restart the 30-day
count. Source: `docs/reflexions/2026-10-20-note-english-switch.md`.

## Decision
Each EupaDev platform decision is a self-contained, immutable ADR in
`docs/adr/`, written in English, under the following rules.
- **Place**: `docs/adr/NNN-kebab-title.md`, `NNN` sequential on 3 digits,
  never reused; the file is never renamed, except once by the translation
  below. Platform decisions only (a generated tool has its own
  `docs/DECISIONS.md`).
- **Format**: flat frontmatter and the sections of `docs/adr/template.md`:
  Context, Decision, Rejected alternatives, Consequences, Verification;
  **Rejection**, optional, written in the commit that rejects. A
  superseded ADR gets no section. Frontmatter comments only at the start of
  a line.
- **Language** (ADR-025): English, authoritative. An ADR's French
  translation lives under `docs/fr/adr/` with the English file name; it is
  not frozen and may be corrected. The French originals copied by the
  translation below keep their original file names there and are not
  edited.
- **Self-contained and short**: decision, context and reasons written in
  the ADR, in about one page; a note may be cited as a source and hold the
  detail (measures, quotes), never serve as the explanation.
- **No progress in the body** ("done on", "to date", blockers):
  Verification describes the mechanism, in the future tense if it does not
  exist yet; progress lives in `ROADMAP.md`.
- **`check`**: `in-place`, `partial`, `planned` or `none`; mandatory, the
  only field that still changes after acceptance. Declarative: the CI
  checks its presence and value, human review its truth. Written only in
  the ADR, shown by the registry.
- **Date** = date of the decision: empty while proposed, filled at
  acceptance or rejection, never in the future.
- **Statuses**: `proposed` → `accepted` or `rejected`; `accepted` →
  `superseded by ADR-NNN` or `withdrawn`.
- **Acceptance**: a decision-maker of `decision-makers` reviews the ADR
  (self-contained, no progress, honest verification), then accepts it in a
  dedicated commit "Accept ADR-NNN" that changes only the status and date.
- **No lingering proposal**: an ADR proposed for more than 30 days,
  counted from the commit that added the file, renames followed, is
  reported by a single issue kept by a weekly workflow; no pull request is
  blocked.
- **Immutability**: once an ADR is no longer proposed, its title and body
  are frozen (typos included), and so are `adr`, `date`,
  `decision-makers`, `supersedes`, `related`; only the status (transitions
  above) and `check` change. A proposed ADR changes freely, except its file
  name.
- **Supersession**: Y declares `supersedes: ADR-X`; X becomes
  `superseded by ADR-Y` only when Y is accepted, in the same commit.
- **Never deleted**; the **registry** is generated in `ROADMAP.md` between
  `<!-- adr-registry:start -->` and `<!-- adr-registry:end -->` by the
  checker's `--write`, never written by hand.
- **One-time translation**: a single commit, reviewed by Ilan before it is
  made, (1) copies the ADRs written in French, unchanged, to
  `docs/fr/adr/`; (2) translates every ADR in place to English: title,
  body, statuses, `check` values, headings, cited names per
  `docs/glossary.md`; (3) renames the files to the glossary's English
  names; (4) moves the template, the checker and the registry to this
  vocabulary; (5) adds the French translation of the ADRs written in
  English. For that commit only, the checker maps the old file names and
  French vocabulary of the base to the new ones, checks that numbers,
  statuses, frozen fields and supersessions still match, and lets titles
  and bodies change (the review covers the translation); the mapping
  applies only to a base file that still has the French vocabulary, so
  afterwards any change to the title or body of an accepted ADR is refused
  again.
- **One-time product rename**: the product will get a new name before
  publication. A single commit, reviewed by Ilan, replaces the old product
  name and the identifiers built on it (the `eupadev`/`EupaDev`
  family) in every ADR, frozen ones included, and may rename the files
  that carry it. For that commit only, the checker accepts a frozen title
  or body whose only differences are that substitution: it replaces the
  old name by the new one in the base text and requires an exact match;
  any other difference is refused as before.
- **Until the translation commit**, ADR-011's vocabulary and checker stay in force
  for every ADR, this one included.

## Rejected alternatives
- Keep the French ADRs frozen and add English translations beside them
  (`docs/adr/en/`) — the authoritative text would stay French, against
  ADR-025, and would cite names that no longer exist in the code.
- Supersede each frozen ADR by an English one — 17 new ADRs restating the
  same decisions, each to accept again, for a change of language only.
- Keep the French file names — every link and the registry would carry
  French names, which `check-english.py` reports, forever.
- English vocabulary for new ADRs only — the checker would accept two
  vocabularies forever.
- Amend ADR-011 in place — it is accepted, hence frozen by its own rule.

## Consequences
- The promise "frozen, typos included" is broken twice, openly, each time
  in one reviewed commit (translation, then product name); the French originals stay readable under `docs/fr/adr/`
  and in the history.
- A translation error found in an accepted ADR after that commit stays,
  like a typo; if it makes the decision ambiguous, a new ADR supersedes it.
- Changing one's mind still costs a new ADR: wanted.
- French translations may lag behind and are corrected freely; the English
  text decides.
- The registry shows missing checks (`planned`, `partial`), but **`check`
  can be wrong without the CI seeing it**: only review, at acceptance and
  at each change of the field, catches it.
- The proposals issue is a reminder (up to a week late), not a constraint.
  A branch rebased before merging restarts from the rebase date; on the
  main branch the date no longer moves.
- **"Refused" means "CI red"** while the repository has no branch
  protection: a push that changes an accepted ADR is made, then reported,
  and must be undone; branch protections will make the refusal effective.

## Verification
The ADR checker, renamed `.github/scripts/verify-adr.py`, tested by
`test_verify_adr.py` and run by `.github/workflows/adr.yml` on every push
and pull request that touches an ADR, `ROADMAP.md` or the check itself,
will compare the tree with the base commit (pull request base, else the
push's previous commit, else the fork point from the main branch; on the
main branch, no base means red). It will fail the CI on: a deleted or
renamed ADR outside the translation mapping; outside proposed, a changed
frozen field, title or body, or a forbidden status transition; a
duplicate number or one that differs from the file name; an unknown
status; a date on a proposed ADR, or a missing, malformed or future one
elsewhere; an unknown `check`, or a missing one on a proposed, new or
leaving-proposed ADR; an inconsistent supersession; a registry that
differs from the generated one. Its tests will cover the translation
mapping and the product-name substitution, and refuse a later change to a
translated accepted ADR and any rename commit that changes more than the
name.
`.github/workflows/adr-proposals.yml`, weekly and manual, will call the
checker's `--proposals` mode (age counted with `git log --follow`) and
open, update or close the single issue, with a token limited to
`issues: write`. `check-english.py` reports French headings or
vocabulary in an ADR. Not mechanically checkable: self-containment, the
absence of progress, the truth of `check`, the presence of the sections,
the faithfulness of a translation, the French originals left unedited,
and the review before acceptance (the "Accept ADR-NNN" commit shows who
and when, not that the review happened).
