---
adr: 000
title: ADR format and lifecycle
status: superseded by ADR-011
date: 2026-10-12
decision-makers: Ilan
supersedes:
related:
---
## Context
The platform's decisions are scattered across `ROADMAP.md` §8, in prose
that gets touched up over time: nobody knows any more what was decided,
when, nor what replaced what. A decision record is worth something only if
it is not rewritten afterwards (ROADMAP §8.15, D-9 and D-10).

## Decision
Each EupaDev platform decision is an immutable ADR in `docs/adr/`.
- **Place and name**: `docs/adr/NNN-kebab-title.md`, `NNN` sequential on 3
  digits, never reused nor renumbered. Platform decisions only: the choices
  of a generated tool stay in its `docs/DECISIONS.md`.
- **Format**: lightweight MADR, frontmatter of `docs/adr/template.md` and its
  five sections (Context, Decision, Rejected alternatives, Consequences,
  Verification).
- **Statuses**: `proposed` → `accepted` or `rejected`; `accepted` →
  `superseded by ADR-NNN` or `withdrawn` (no longer relevant, no successor).
- **Immutability**: the body and title of an ADR that is no longer
  `proposed` no longer change, not even to fix a typo (typos stay). To
  change a decision, one writes a new ADR that declares
  `supersedes: ADR-NNN`, and the old one gets the status
  `superseded by ADR-MMM`. A `proposed` ADR changes freely.
- **Never deleted**: a rejected, withdrawn or superseded ADR stays in the
  repository.
- **Registry**: `ROADMAP.md` §8.11 holds an ADR registry generated from the
  frontmatters; it is never written by hand.

## Rejected alternatives
- Keep everything in prose in `ROADMAP.md` — nothing prevents rewriting a
  past decision without a visible trace.
- adr-tools, log4brains — no release since 2018 and 2024, and neither
  refuses the modification of an accepted ADR.
- Tolerate typo fixes (a "minimal correction" rule measured in words and
  letters) — grey area: "now" → "not" would pass; set aside by Ilan on
  2026-10-12 in favour of the simplest rule.

## Consequences
- Changing one's mind costs a new ADR: this is intended, the history stays
  readable.
- A typo stays; if it makes a decision ambiguous, it calls for a
  superseding ADR.
- The §8.11 registry is regenerated at each addition or status change.

## Verification
`.github/scripts/verify-adr.py`, run by `.github/workflows/adr.yml` on
every push and PR, against the base commit. It refuses:
- the deletion or renaming of an ADR;
- on an ADR that was not `proposed`: a change of `adr`, `date`,
  `decision-makers` or `supersedes`, a status other than `accepted` →
  `withdrawn` / `superseded by ADR-NNN`, and any modification of the title
  or body;
- a duplicate number or one that differs from the file name, an unknown
  status;
- an inconsistent supersession (`superseded by ADR-Y` without a matching
  `supersedes` in Y, or an accepted ADR that supersedes X without X being
  marked superseded);
- a `ROADMAP.md` §8.11 registry that differs from the generated one.
