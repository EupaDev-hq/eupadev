---
adr: 025
title: Repository language
status: accepted
date: 2026-10-28
decision-makers: Ilan
supersedes:
related: [ADR-004, ADR-019, ADR-026]
check: planned
---
## Context
The EupaDev repository will be published as open core (Apache 2.0):
developers outside the team must be able to read it and contribute. Most
of it is written in French. Measured on commit `77e6d10` (2026-10-28),
`check-english.py` (see Verification) reports 37,287 French lines in
tracked files, private notes excluded: identifiers, file and directory
names, SQL objects and stored values, API routes and JSON fields,
environment variables, infrastructure names, log and CI messages,
comments, documents and 22 of the 25 ADRs. Since 2026-10-20 new text has
been written in English while the rest waited, so files mix both
languages. Many names cross a file or process boundary: a core export is
used by the tool template and the engine, a state id is stored in the
engine database and read by lab playbooks, a CI job id is stored as a
check name. Translating one end alone breaks the others, often silently
(a CI path filter that no longer matches simply stops running). On
2026-10-28 Ilan decided that nothing stored or published on the lab is
kept: its databases, forge content, published core versions and secrets
can be recreated, so the lab can be rebuilt instead of migrated. Sources:
`docs/reflexions/2026-10-20-note-english-switch.md` (inventory, couplings,
plan), `docs/glossary.md`.

## Decision
English is the original language of the repository; French is a
translation.
- **Code and machine text: English only.** Identifiers, file and directory
  names, wire formats (routes, parameters, JSON fields, stored values,
  error codes, log fields), messages for developers and operators (linters,
  CLI, logs, CI output, database errors), comments, commit messages, and
  text for agents (prompts, task files, instructions).
- **Documents: English, authoritative.** A French translation exists only
  for documents read outside the team: README, CONTRIBUTING, architecture,
  governance, deployment, client prerequisites, ADRs and the tool
  template's instructions; root files as `X.fr.md`, the others under a
  `docs/fr/` that mirrors the English path and file name. The roadmap, the
  `CLAUDE.md` files, component READMEs and the state machine document are
  English only.
- **End-user text** (tool screens, engine mails, the requester's page):
  i18n dictionaries `lang/en.json` and `lang/fr.json` beside the code that
  shows them, with English keys; a deployment setting chooses the
  language, French on the lab. A stored value is never shown as is.
- **Private notes** (`docs/reflexions/`): stay French in the private
  repository and are never published; new notes are written in English.
  Links to them are allowed while the repository is private and removed
  before publication.
- **One glossary**: `docs/glossary.md` is the only French to English
  mapping (domain terms, a word dictionary, every name that crosses a
  boundary). A name missing from it is added before it is renamed; changing
  an English choice changes the glossary first. A change that touches a
  French name writes its final English name, never a half-translated one.
- **Spelling**: British English (`organisation`, `licence`, `catalogue`).
- **No compatibility kept**: the migrations of the core, of the example
  tool and of the engine are rewritten in English in place, once, an
  exception to "expansion only" (ADR-019) and to migration immutability
  (ADR-004); live infrastructure names (Compose projects, systemd units, VM
  paths, Gitea and Keycloak names, vault files) are renamed directly and
  the lab is rebuilt from scratch: no renaming migration, no data update,
  no alias.
- **Product name**: out of scope; the current name and the identifiers
  built on it are changed by a separate rename pass.

## Rejected alternatives
- Keep French in the code, translate only the documents — identifiers,
  stored values and messages stay unreadable to contributors.
- English for new text only (the rule of 2026-10-20) — files mix both
  languages indefinitely, and a name translated at one end breaks its
  other ends.
- Translating each area without a shared mapping — the same French word
  gets several English names in areas whose names must match.
- A renaming migration for the databases, with a data update after
  draining the running workflows — it keeps the French history in every
  database and breaks "expansion only" on every installation, to preserve
  data that nobody keeps.
- Renaming live names one at a time, with an Ansible migration step and
  volume copies — the same work, for a lab state the rebuild resets.
- Translating `docs/reflexions/` — 117 files, 23,659 lines of private
  working notes that will not be published.

## Consequences
- One large, one-time change across every area, cut along the couplings
  rather than the directories; the lab is rebuilt from scratch and
  everything stored or published on it is lost on purpose (databases, tool
  repositories created from the old template, published core versions);
  secret values are entered again.
- Accepted ADRs are translated once in place (ADR-026): their wording
  freeze is broken once.
- Contributors read and write one language; French-speaking users keep
  French screens, mails and key documents through translations, which may
  lag behind the English.
- Every end-user text goes through a dictionary: two files per text, and
  a key derived from a rendered text (the engine's mail deduplication uses
  the subject) must use the message key instead.
- Limit: the check uses word lists, not a language detector; a French
  sentence made only of unlisted words and English homographs escapes it,
  and an English line quoting a listed French word must be allowed with a
  reason.

## Verification
`.github/scripts/check-english.py`, tested by `test_check_english.py`,
reports every tracked line that still contains French: an accented letter
or a French quotation mark, French function words, a French word of the
glossary's word table alone or inside an identifier, a French compound
name of the glossary. Allowed: French translations, private notes, French
dictionaries and the entries of `check-english-allow.txt`, each with a
reason. A workflow `english.yml` will run it on every push and pull
request, without path filter, on the lines added since the base commit
and on the whole repository; the full scan will fail while a French line
remains outside the allowed paths. Not mechanically checkable: the quality
of a translation, English choices beyond the glossary, British spelling,
that a French translation matches its English document.
