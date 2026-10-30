---
adr: 017
title: Identity of people, (issuer, subject) under Keycloak, two hats and four eyes
status: accepted
date: 2026-10-16
decision-makers: Ilan
supersedes:
related: [ADR-003, ADR-007]
check: partial
---
## Context
The engine records who acts in append-only audit tables kept three years
(`tool_history`, `approvals`, `messages`). Until now the local API trusted
the name the caller wrote in the body (`actor`, `author`), the person was
designated by their e-mail (`tools.requester`), no gate checked who
decided, and an idempotency key was valid for everyone. As long as only
Ilan calls the API through an SSH tunnel, this is not a hole; as soon as a
second human arrives, every audit row written in this form is lost for good
(never rewritten) and every generated tool would copy the classic mistake
"the user is their e-mail".
Facts gathered on 2026-10-15 from the primary sources (Keycloak 26.8,
OpenID Connect Core 1.0 §5.7, RFC 9068, RFC 8725, RFC 9700): only the pair
`(iss, sub)` is stable and unique; the e-mail changes (marriage, merger of
domains) and gets reassigned; the Keycloak `sub` changes in realistic cases
(LDAP federation without import and renaming, deletion of the federation
component, restore of an earlier backup, recreated client), which rules
out a unique key directly on the table of people; realm roles leak into
every token whereas client roles stay within the audience; an RFC 9068
access token carries `typ: at+jwt`, and Keycloak sets it only when asked
to, per client. Detail and sources:
`docs/reflexions/2026-10-15-analyse-keycloak.md` (D1 to D15) and
`docs/reflexions/2026-10-15-note-identite-I0.md`.

## Decision
Designate every person by an internal identifier linked to their OIDC key
`(issuer, subject)`, Keycloak being the only issuer, and have rights carried
by two hats read from the token.
- **Table `actors`** (`id uuid`, type human or machine, e-mail and name
  as contact attributes refreshed on every request, never keys) and
  **append-only link table** `actor_identities (issuer, subject) →
  actor_id, since, reason`. A subject that changes is relinked by an INSERT
  by an administrator, with its reason; never by an UPDATE, never by the
  e-mail. The audit tables carry `actor_id` and keep the name displayed at
  the time of the facts; earlier rows stay readable as they are.
- **Access token verified by the engine**: signature by the internal JWKS,
  `alg` in a closed list (RS256, ES256), `typ: at+jwt`, `iss` equal to the
  frozen public issuer (`https://auth.<domain>/realms/eupadev`),
  `aud` containing `eupadev-api`, not expired; a key-bound token
  (`cnf`) is refused as long as the proof is not verified. The identity
  never comes from the request body; without a token, 401; without a hat, 403.
- **Two hats**, roles of the client `eupadev-api` read from
  `resource_access.eupadev-api.roles` and never stored: `requester` and
  `admin`. Gate decision and cancellation require `admin`; feedback,
  abandonment and message are reserved to the tool's requester (or to an
  `admin`); a request requires one of the two hats and a known e-mail
  address. An evolution makes its author the tool's requester.
- **Four eyes at Gate 2**: the approval of a delivery is not made by the
  tool's requester, a rule applied by the engine and by the database.
  Only exception: the subject designated by `FOUR_EYES_EXEMPTION_SUBJECT`
  (empty by default); every use is recorded in
  `approvals.four_eyes_exemption`, next to the hat used
  (`approvals.role`).
- **Idempotency per person**: a call's key is valid for its author
  (`api-<actor>-<key>`), never for another.
- The verification service accounts (`check-requester`, `check-admin`)
  exist only in the lab.

## Rejected alternatives
- Keeping the e-mail as identity, with Keycloak in front — the e-mail
  changes and gets reassigned (OpenID Connect Core §5.7); the audit would
  designate a mailbox, not a person.
- `UNIQUE (issuer, subject)` directly on `actors` — at the first changed
  `sub`, the same person becomes two actors and three years of audit can no
  longer be reconciled without an UPDATE of a frozen table.
- Temporary local issuer (`urn:eupadev:local`) while waiting for
  Keycloak — a second identity contract to migrate afterwards; Keycloak is
  one more Ansible recipe, not an obstacle.
- Realm roles, or roles stored in the engine's database — the former leak
  into every token; the latter survive revocation in the directory,
  contrary to the requirement "leaving = deactivation everywhere".
- Four eyes only in the code — a direct UPDATE in the database would bypass
  it; the trigger refuses it too, recorded exemption or nothing.
- Automatic linking of a new `sub` by the e-mail — that is the auto-link
  Keycloak itself calls dangerous; an admin and a reason.

## Consequences
- Every API caller needs a Keycloak token: the lab's verification cycles
  go through service accounts, and the cycles in progress at deployment
  time are cancelled (DBOS messages of the old form, no dual reading).
- A person signed in with a new `sub` before being linked becomes a second
  actor that the primary key forbids linking afterwards: both stay
  readable, the audit is not touched; a cost accepted as long as the case
  has not happened.
- A token without `email` allows signing in but not submitting a request:
  notifications go out by e-mail.
- The list of hats is closed; a business referent or a security role will
  come through a new ADR, not through a free column.
- Generated tools will inherit the same rule (`(iss, sub)`, never the
  e-mail) in the template's OIDC building block, the subject of a separate
  step.

## Verification
Engine tests (GitHub CI, `.github/workflows/engine.yml`):
`tests/auth.test.ts` refuses `typ JWT`, `alg none` and HS256, missing
`aud`, different `iss`, `cnf`, expired token, and re-reads the JWKS only
once per pause for an unknown `kid`; `tests/db.test.ts` proves two
subjects = two actors, link by INSERT = same actor, UPDATE and DELETE
refused, same e-mail without merge, engine rights limited to the contact,
refusal by the database of the Gate 2 self-approval without exemption;
`tests/service.test.ts` proves 401 without a token, 403 without a hat, 403
for a requester who decides, a third party who judges or the requester who
approves their Gate 2, recorded exemption, distinct idempotency key per
person; Gherkin scenarios I0-1 and I0-2; mutations `ID-…`
(`tests/mutations/mutations.ts`) killed by these tests, under the ratchet.
In the lab, `verify-keycloak.yml` will check the discovered issuer,
`typ at+jwt` and the audience of each issuing client, the absence of
`check-*` outside the lab; `verify-engine.yml` will run a cycle with two
identities (feedback by `check-requester`, decisions by `check-admin`) and
check the recorded hat. Not mechanically checkable: the reason of a manual
link, and the fact that `FOUR_EYES_EXEMPTION_SUBJECT` stays empty outside
the lab.
