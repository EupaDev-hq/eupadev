---
adr: 031
title: Chat commands in plain words, a small model maps a sentence to one allowed action or to "unclear"
status: proposed
date:
decision-makers: Ilan
supersedes:
related: [ADR-013, ADR-017, ADR-018, ADR-024, ADR-027]
check: planned
---
## Context
Everything a person can do in a cycle is one of six strictly validated
API messages: the requester's feedback on the mock-up (satisfied,
correction) and on the Preview (satisfied, bug, new capability), their
abandonment and free message, the admin's decision at a gate (approved,
correction, refused, scope change, with an optional top-up at the four
gates whose phase has a budget envelope and the candidate digest at
Gate 2) and the cancellation. The identity, the hat and the four-eyes
rule are applied by the server from the token, never from the body
(ADR-017). On the requester web page (ADR-024, commit 6f9261d), a typed
text never acts by itself: a sentence made only of yes-words (lists `YES`
and `FILLER` in `orchestrator/web/app.js`) asks "did you mean to
approve?", any other sentence asks which outcome it is, and every outcome
is a click; the admin decides at a gate through a card with a comment
box, a top-up box and one button per outcome, the chat input disabled.
Ilan tested it on 2026-11-06: "any synonym of OK must be understood as OK;
you say 'I approve', it approves; you say 'I raise the budget', it raises
the budget, simply, it must not approve or start a correction instead".
Word lists cannot tell "ok but the filter is missing" from "ok, great",
nor "approve with 20 more" from "20 rounds and still nothing, refuse",
without becoming a grammar nobody maintains. The only route to the AI
provider is the AI proxy of the agents VM, which adds the key from a file
and publishes no port; the engine VM (pilot, API, page) has no AI route
and no key. A small model called by the platform itself has a precedent:
the diagnosis task (ADR-027) and the `overlap` role on Haiku. Source:
`docs/reflexions/2026-11-07-note-chat-natural-commands.md`.

## Decision
Understand a typed sentence with a small model that may only answer one of
the actions the current state allows for the person's hat, or "unclear",
and let the person's own API message carry the decision.
- **Bounded enum**: for each sentence the engine computes the allowed set
  from the state machine (`gateOutcomes`, the feedback events of the
  waiting states, `topUpEnvelope` for the top-up name, the abandonment
  states); the model's answer is a JSON object `{ intent, amount_usd? }`
  whose `intent` is an enum of that set plus `unclear`. A requester at a
  gate, or anyone in a state that expects nothing, has an empty set and
  the model is not called.
- **Server re-validation**: an answer outside the set, a top-up name
  without an amount, an amount with another name, over the cap
  (`MAX_TOP_UP_USD`) or at a gate without an envelope becomes `unclear`.
  The model writes nothing a human reads and never rewrites the sentence:
  the human's text, verbatim, is the message's `text` or `comment`.
- **The decision stays the person's**: the intent endpoint
  (`POST /requests/<id>/intent`, cookie or Bearer, `X-EupaDev` header,
  per-actor rate limit) returns the understood intent and whether it is
  paid; the page then posts exactly the message a button would have
  built, through `POST /messages`, under the person's actor and hat, with
  every existing check (four eyes, digest, comment and envelope rules).
  Each sentence, its allowed set, the answer, the model and its cost are
  recorded in the `intents` table.
- **Confirmation policy**: a free action acts at once; a paid action
  (correction, bug, new capability, scope change, top-up, approval that
  restarts agents) or an irreversible one (abandon, refuse, Gate 2 =
  production) shows what was understood and one "Approve" button,
  nothing is spent or ended before the click; one question only when the sentence
  is not plain, on any action, never two questions in a row; a top-up
  read in a sentence is a top-up, it never approves nor starts a
  correction by itself; every sentence gets an answer in words, a
  sentence for another hat or another place is told where to go.
- **Route C**: the call runs on the executor (agents VM) as a DBOS
  workflow on its own queue, reaching the AI proxy through a dedicated
  internal network; the pilot starts the workflow and waits with a
  deadline. The engine VM gets no AI route and no key. Model id and
  effort are configuration, the prompt ships in the engine image
  (ADR-018).
- **Degraded mode**: `unclear` → the question with the state's outcomes
  as buttons; model unreachable, executor paused, timeout or malformed
  answer → one clear error and the buttons that post without AI (the
  admin's approve, refuse and top-up survive the buttons' removal as this
  fallback), and the admin is notified. Never a guess on a paid or
  irreversible action.
- **Fake reader**: the reader sits behind a contract
  (`IntentReader`: hat, state, allowed set, language, pending question,
  text → intent, amount, reply) with a fake built from the word lists, so
  that every test runs without an AI call (ADR-013 spirit), the discovery
  mode (no Anthropic key) has a reader, and another provider stays
  possible. The model's own words (`reply`) are shown as plain text; every
  line that announces an action comes from the dictionary.

## Rejected alternatives
- Word lists alone, extended — negation, contrast, mixed intents with
  numbers and two languages make each new word a commit, and a false
  positive acts for real; kept as the degraded mode only.
- Free-text answers from the model — a model text shown to a human or
  posted as a message is an injection surface; the enum and the
  dictionary strings leave it none.
- The pilot calls the AI proxy over the lab network (route A) — the
  key-adding proxy would listen on a VM port anyone reaching it could
  spend from.
- A second AI proxy or the key on the engine VM (route B) — the key in
  two places, on the most exposed component.
- Zero confirmation on paid actions — a misread correction starts agents
  for real; one click after the sentence is understood costs less than
  the run.
- A rule "always one question on irreversible actions" — a plain "I
  refuse" would always be asked twice; the question is reserved for a
  sentence that is not plain.

## Consequences
- The person talks; the buttons become the fallback and the gate card
  information. Each sentence costs a fraction of a cent and one to three
  seconds, counted by the cycle, never by the budget guard-rails.
- Understanding needs the agents VM up: otherwise the page asks with
  buttons, as today, and the admin learns it.
- A wrong classification among allowed intents remains possible; its
  damage is bounded by the click on paid actions and the question on
  sentences that are not plain; refusal, abandonment and Gate 2 stay
  irreversible by nature.
- The buttons are removed only after an evaluation set of forty sentences
  per hat scores 100 % correct-or-unclear on the paid and irreversible
  rows, on the lab, with the real model; that set is then the proof of
  the prompt and the wiring at each prompt change.

## Verification
The engine's CI will check, without a database: the allowed set per
state and hat (a requester at a gate gets an empty set, the top-up name
exists only at the four envelope gates, the incident gate offers retry
and refuse) and the re-validation (outside the set, amount over the cap,
top-up without an amount, amount with another name → `unclear`; a top-up
answer is never turned into an approval), one mutation per rule. Against
a throwaway PostgreSQL: the endpoint refuses a missing header, a missing
token and a stranger, limits the calls per actor, records each sentence in
`intents`, which the engine can neither update nor delete. Through the
page (Playwright, fake reader): "I approve" posts the feedback, "ok but
the filter is missing" asks, a requester's "approve Gate 2 with 100 000"
never posts a decision, a paid intent waits for the click. On the lab: an
Ansible recipe will run one sentence through the executor's route with a
fake upstream, check that the executor container reaches nothing else new
and that `PAUSE_AGENTS=1` yields the fallback. Not mechanically checkable:
the model's accuracy (measured by the evaluation set, recorded in the
note) and the plainness of a sentence.
