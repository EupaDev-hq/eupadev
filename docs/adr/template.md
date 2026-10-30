---
# Comments only at the start of a line; a "#" inside a value is part of it.
# adr: 3 digits, = start of the file name, never reused.
# status: proposed | accepted | rejected | withdrawn | superseded by ADR-NNN
# date: EMPTY while the ADR is proposed; filled at acceptance (or rejection)
#   with the date of the decision, YYYY-MM-DD, today at the latest.
# supersedes: ADR-NNN superseded by this one, or empty. related: [ADR-NNN, ADR-NNN] or empty.
# check: in-place | partial | planned | none — state of the mechanical check described
#   in "Verification"; the only field that still changes after acceptance.
adr: NNN
title: Short title of the decision
status: proposed
date:
decision-makers: Ilan
supersedes:
related:
check: planned
---
## Context
The problem and the forces, written in full (measured facts, with their
source). Understandable without opening another document: a source may be
cited, not serve as the explanation. The ADR fits in about one page:
measures, quotes and long arguments go in the cited note.

## Decision
One imperative sentence. Then the details as a list.

## Rejected alternatives
- Option — why not (a fact, not a taste).

## Consequences
Positive and negative, including the accepted cost and the limits.

## Verification
The mechanism that checks or will check the decision (CI, Opengrep, kit
test, diff check), or "not mechanically checkable" spelled out. True
whatever the state of the check: a mechanism not built yet
(`check: planned`) is described in the future or conditional tense ("the
CI will refuse…"). Never progress ("done on…", "not written"): it lives in
`check` and in `ROADMAP.md`.

## Rejection
Optional section, only for a rejected ADR: written in the commit that
rejects it, it says why. Delete this section otherwise.
