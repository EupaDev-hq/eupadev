# EupaDev orchestrator

Code of the v2 orchestrator (`ROADMAP.md` §8.13): strict TypeScript run
directly by Node 22+ (erasable syntax, no build), state in PostgreSQL,
DBOS durable workflows (a library, not a server).

**Status: step §8.9 no. 2-3, first slice** — the engine runs and is tested
locally against a throwaway PostgreSQL: workflow W1 `toolCycle` (the whole machine),
W2 `agentTask` (queue with concurrency N, N = 1 by default), gates (`waitForDecision`),
**fake** outside world (agent engine, forge, deployments, notifications),
configuration checked at start-up, Gherkin scenarios run against the real
engine, crash-recovery test, **safety net**: gate "technical incident"
(D21), automatic retries, full validation of the messages, **no volatile memory** (D22: a dead W1, resumed
from the start, picks up where it was), **native DBOS features** (§8.14: code update by patching,
monitoring by a scheduled task, native timeout of the operations, native end of the child workflows, resumption of a dead W1 by
`rewindWorkflow`), **one engine at a time** (lock in the database, D23), deadlines counted from the first entry into the
state, gate without a decision reminded every week, tests checked by mutations.
**E0 ("engine for real" note)**: the engine runs as a service — Docker image, secrets read from files (`*_FILE`),
automatic fakes (`EUPADEV_EXTERNAL=fake-auto`), local API (`curl` through an SSH tunnel), emergency stop
(`PAUSE_AGENTS=1`): see "As a service". The Compose file, the `systemd-creds` secrets and the lab test are on the `infra/` side.
No Conductor, no AI call. **E2**: real forge (Gitea 28), chosen by `EUPADEV_EXTERNAL=forge=gitea`, the
rest automatic fakes; **E1**: real mails (SMTP, nodemailer), chosen by `notifications=smtp` (can be combined:
`forge=gitea,notifications=smtp`), a single mail per notification even after a hard stop; **E3**: real integration and
merge (local Git in the engine) and "pushing fake" (`engine=pushing`: reports without AI, files
really pushed with the token of `svc-agent`, lab only); **E4**: CI watcher (DBOS scheduled task, real forge
only: runs and jobs of the squash's CI, digest read in the registry → `ci_finished`; green CI but image missing from the registry → incident gate at once, with the exact reason); DBOS history of the scheduled tasks purged by the monitoring (successful passes older than one day, `purgeScheduled`); the other real adapters are steps E5 to E7. **Launcher, step 4**: Claude Code
engine in a container (`src/external/claude-engine.ts`, `EUPADEV_EXTERNAL=engine=claude`), tested locally with a
fake `claude` (`docs/reflexions/2026-10-13-note-e4-moteur-claude.md`); real test on the agents VM still to do.

## Contents

| Path | Role |
|---|---|
| `src/machine/states.ts` | **Single source** of the state machine of a tool's cycle (W1): states, transitions, default thresholds |
| `src/hardening/stagnation.ts` | **Anti-loop** (ROADMAP E9, D20 — M1 to M7) as pure functions: deduplication by (`rule`, `file`), identity cascade, patience, Git tree hash per role, Opengrep identity. Called by W1 at the evaluation and at the entry of the round |
| `src/config.ts` | Configuration read from the environment and **checked at start-up** (E10): refused with `<VARIABLE> missing`. Delays (24 h, 30 d, 60 min, 15 min, 7 d…) derived from the thresholds, overridable one by one for the tests; those that arm a Node timer bounded to 2³¹−1 ms; scheduling of the monitoring (DBOS cron, checked at start-up) |
| `src/db.ts` | Access to the business database: `transition` (an UPDATE that the trigger checks, idempotent on replay, **workflow memory recorded in the same transaction**, D22), pass in the state = **first entry** (a resumption after an incident does not open a new one, G5), idempotent in-place restart (M6), tasks (attempts `-r<n>`, B3), deviations, counters derived from the tables, cost = sum of `tasks.cost_usd`; one deployment recorded per operation (G3); retryable writes without duplicates (B8). No access to the internal tables of DBOS |
| `src/messages.ts` | The messages W1 receives in its single mailbox: humans and forge (the ends of tasks and operations are read natively, S4) |
| `src/external/contracts.ts` | **Contracts of the outside world**: agent engine (input role/instructions/context/cap → report, cost, duration, tree hash), forge, deployer (W4: deployment, stop and removal **per cycle**, G4; what is served, can be queried), notifications (idempotency key, M9) |
| `src/external/fakes.ts` | Their **scriptable fake** implementations: each call waits for an answer prepared by the test (or computed by an `auto` function), everything is logged, a task asked again on replay gets the same answer; the deployer can serve a digest other than the one requested (M5). **Automatic fakes** (E0): "all is well" answers on their own, and a fake watcher that sends the green CI and the green Preview pipeline |
| `src/external/gitea-forge.ts` | **Real forge** (E2): Gitea 28 through its REST API (native `fetch`, token of `svc-orchestrator` in a header) — creation from the template with its protections, assignment to the `agents` team, removal of the administration **checked**, idempotent resumption; integration (E3, local Git in a throwaway clone: role branches merged into `integration/<cycle>/<round>`, conflicts named, push never forced, token through Git's environment); merge: net diff checked per role (what the role brought to the integration), PR `integration/<cycle>/<round>` → main, squash (never `force_merge`); watcher (E4, `ciFinished`): squash commit read in the round's PR, last run of `check.yml` on main for this commit, jobs (skipped ones left out), digest asked of the registry (`Docker-Content-Digest`), never the commit statuses. Typed errors (`transient`: 5xx, 429, network, timeout, already retried; otherwise final refusal), never the token in a message |
| `src/external/smtp-notifications.ts` | **Real mails** (E1): one text mail per notification, over SMTP (nodemailer) — Mailpit on the lab, the client's relay in production; admin = `ADMIN_ESCALATION_ADDRESS`, requester = `tools.requester` (address required at entry); **idempotency**: key inserted into `sent_notifications` and mail sent in a single transaction (key already committed → nothing goes out again, even when a step is replayed after a hard stop or for two simultaneous attempts); `Message-ID` = sha256 of the key; subject passed as is (no header built by hand) |
| `src/external/claude-engine.ts` | **Claude Code engine** (launcher, step 4): bare clone of the tool (token of `svc-agent` in a header), `git bundle` of the base, hardened throwaway container (`runsc`, read-only root, no capability, uid 10001, the task's `--internal` network, the task's volume), `claude --bare -p` with JSON output; report, cost, tokens and stop reason read in the `result` message; work fetched by bundle into the clean clone (strict fsck, never Git in the agent's repository), pushed without force to the task's branch only; cancellation = `docker rm -f`; replay: leftovers removed, base = branch already pushed. **Harness**: `--bare --restricted`, `dontAsk` for all the roles (never bypassPermissions), Bash and Edit allowed to the code roles, `--add-dir /tmp/task`, `--strict-mcp-config`; `--bare` exposes only Bash, Read, Edit. **Net content checked before the push** (`contentRefused`): forbidden path, outside the role's scope (`inScope`), symbolic link, submodule, name with an invisible character. **`overlap` without a repository** (`ROLES_WITHOUT_REPO`): neither clone nor push, catalogue of the tools as data in `task.md` |
| `src/agent-engine/report.ts` | Validation of a report against `tool-template/agents/report.schema.json` (Ajv, closed lists M1): invalid = failed task |
| `src/agent-engine/instructions.ts` | **Instructions of the roles** (`docs/reflexions/2026-10-15-note-consignes-agents.md`): `AGENTS.md` + `agents/<role>.md` + the role's domain rules (`.claude/rules/*.md` without frontmatter), read at start-up in `INSTRUCTIONS_PATH` (the template in dev, `/app/instructions` in the image), never in the cloned repository; fail-closed (missing file, empty or with an invisible character = no start-up); W1 passes them as they are to each task (DBOS records them) |
| `src/agent-engine/forbidden-paths.ts` | **A single list** of the paths no agent changes (`.claude/`, `.gitea/`, `agents/`, `AGENTS.md`, `.npmrc`, `.pnpmfile.cjs`…, root and subfolders): refused by the launcher before the push (`contentRefused`), by the `managed-settings.json` of the agents' image (generated) and by `gitea_protected_files` (checked by `tests/forbidden-paths.test.ts`) |
| `src/text.ts` | Invisible or control characters (zero-width, bidi, Unicode tags) refused in the instructions, the message texts and the names of pushed files |
| `src/workflows/toolCycle.ts` | **W1**: loop "read the state and the memory in the database → process → transition"; durable waits (`DBOS.recv`), deadlines and reminders read in the history, gates (3 reminders then one reminder a week, S6), cancellation E15 in any non-final state (even transient), ends (notification + retried cleanup, limited to the cycle's resources — Preview always removed, Prod removed from a creation that does not succeed —, alert if incomplete); tasks and outside operations as **child workflows whose native end W1 waits for** (`DBOS.waitAll` + status/output, S4), operations with a **native timeout** (`timeoutMS`, S3); deployed digest compared with the expected one (Prod serving another digest: recorded, removed or restored, alert, M5); **error boundary**: any exception → incident gate (D21), never a dead workflow; failure during the incident: new attempt after a short, growing wait, cancellation read during the wait; a message received during the incident is not kept: the resumed state **asks for it again** (S5) |
| `src/workflows/agentTask.ts` | **W2**: one agent task in the queue (N in total, 3 per tool), per-task timeout enforced, engine output bounded, report validated, unknown cost = cap, `tasks` written; no message: W1 reads its native end (a W2 in ERROR → task closed as failed at the cap by W1) |
| `src/workflows/deps.ts` | DBOS steps with retries after a growing wait (A3) and a maximum duration per attempt (B1), sorting of the errors (final / transient / DBOS's own), exact text of an error, ids (`cycle-<id>` stable, `task-<id>`), stop of the child workflows of a W1 (`listWorkflows` by parent + `cancelWorkflows`) |
| `src/migrate.ts` | **Migration** (owner account, `pnpm migrate`): versioned migrations (node-pg-migrate "up"), then the `dbos` schema by the official function `DBOS.migrate(url, { applicationRole: 'orch_engine' })` |
| `src/orchestrator.ts` | Start-up (config, **"one engine only" lock** taken on a dedicated connection — clear refusal if another engine holds it, clean stop if it is lost, D23 —, DBOS with **patching** enabled (constant application version, S1), queue, **sweep** at start-up and then by a **DBOS scheduled task** (`applySchedules`, S2), one at a time: decision on the real state of each cycle (G1), W1 really dead (ERROR, CANCELLED, MAX_RECOVERY_ATTEMPTS_EXCEEDED, waiting at another executor) → children stopped, incident, W1 **resumed from the start under the same id** (`rewindWorkflow`) + alert; environments still served for a finished cycle or an archived tool removed with an alert; a cycle in error does not stop the others); `newRequest` (validated; tool + cycle in one transaction → W1); `send` (message validated in full, then checked against the machine; dead workflow → resumed, message refused except a cancellation or an unchanged pass, e.g. a decision at the incident gate, M3; marked with the current pass; the cancellation also stops the children; `transmitted: true` only if delivered to a live workflow and in the targeted pass, checked at the delivery itself: the cycle is held in its pass by a shared lock on its row) |
| `src/main.ts` | Entry point of the process: outside world chosen by `EUPADEV_EXTERNAL` (`src/external/world.ts`), fake watcher, local API |
| `src/api.ts` | **Local API** (`node:http`, §8.16 M8): `GET /health`, `POST /requests`, `GET /requests` (my requests; all for an admin), `GET /requests/<cycle>`, `GET /requests/<cycle>/messages?since=<id>` (the chat; reads limited to the tool's requester or an admin), `POST /messages`; local `Host` only, header `X-EupaDev: 1`, **Keycloak access token required** except `/health` (401 + `WWW-Authenticate`, 403 without a hat or when an authorisation rule is broken, I0), the identity never comes from the body, `Idempotency-Key` + actor = id of the DBOS workflow, bodies validated by Ajv, RFC 9457 errors |
| `src/auth.ts` | **Identity** (I0, ADR-017): access token checked with `jose` (internal JWKS, `alg` RS256/ES256, `typ at+jwt`, `iss`, `aud eupadev-api`, `cnf` refused), principal `(issuer, subject, mail, name, hats)`; hats = roles of the `eupadev-api` client only. Resolved into an actor by `Database.resolveActor` (table `actor_identities`, never by the mail) |
| `Dockerfile`, `Dockerfile.dockerignore` | Image of the engine (built from the root of the repository): two commands, non-root user, read-only possible, `HEALTHCHECK` on `/health`, reports schema copied into it |
| `tests/machine.test.ts`, `tests/stagnation.test.ts` | Tests without a database: no dead end, decisions, mechanisms M1–M7 |
| `tests/instructions.test.ts`, `tests/forbidden-paths.test.ts` | Instructions assembled from the template, fail-closed, Unicode filter (instructions, messages); forbidden paths, scope per role, Gitea list and managed deny equal to the constant |
| `tests/feature-coverage.test.ts` | Every transition has its `@t:` scenario; shows the count of the scenarios **wired** to the engine (without `@to-wire`) |
| `tests/db.test.ts` | Schema and triggers against a throwaway PostgreSQL 18.6; refusals opposed to the `orch_engine` account (SQLSTATE 42501) and its normal writes, triggers included |
| `tests/engine.test.ts` | Creation then evolution end to end on the real DBOS engine (one task per role and per iteration, budget traced, cleanup) + E10; the engine runs as `orch_engine` and refuses to start without the DBOS schema installed (step 6) |
| `tests/resume.test.ts` | **Crash recovery**: child process killed (SIGKILL) in the middle of a task (two others queued), in the middle of an outside operation, in the middle of Gate 2; restarted three times, cycle finished without duplicates (interrupted task run exactly twice and billed cap + cost); **persistent log of all the side effects of the fakes** (engine, forge, deployer, notifications): nothing doubled on replay |
| `tests/robustness.test.ts` | One test per robustness fix (1st review: A2–A8, B1–B9, C1; 2nd review: "2nd round" B1, B5–B8, C, D2; "3rd round" G3, G5, M4–M6, M9, operation result arrived just before the end of the child): incident instead of a silent death, retries, W2 that always warns, invalid messages refused, silent operation bounded, deployed digest checked (and Prod removed or restored), Prod/Preview removed, null cost, writes without duplicates, candidate digest never stale, deadlines and reminders from the first entry… |
| `tests/replacement.test.ts` | **No dead end** (S1, A1, A2, B2–B4): code update (W1 resumed in place by patching, without an incident), W1 waiting at another executor, W1 dead and resumed in `candidate_image`, `preview_deployment`, after a message during the pause, at a gate after a correction (two incidents), in scoping with counters — each time up to `end_success`; scheduled monitoring, `send` to a dead workflow, child operations cancelled, cycle in error isolated; review resumed and really restarted; failure during the incident gate |
| `tests/monitoring.test.ts` | 3rd round: one engine only (2nd refused, stop when the lock is lost), sweep without a replayed end or a false alert, cleanup limited to the cycle, orphan environments removed, message received during the incident asked for again (S5), `transmitted` only at a live workflow, decision at the incident gate towards a dead W1, one sweep at a time, end caught up, stopped child operation seen at once, operations cancelled when the W1 dies and on cancellation |
| `tests/config.test.ts`, `tests/service.test.ts` | E0: secrets `NAME` / `NAME_FILE` (without a database); engine as a service with the automatic fakes up to `end_success`, through the orchestrator then through the local API (replays without duplicates), guard-rails of the API, agents paused then resumed; I0: fake IdP (`tests/helpers/fake-oidc.ts`), 401 without a token, 403 without a hat, requester who decides, third party who judges, four eyes and traced exemption, idempotency per person |
| `tests/auth.test.ts` | I0: tokens refused (`typ JWT`, `alg none`/HS256, `aud`, `iss`, `cnf`, expired), realm roles ignored, unknown `kid` = one JWKS reload per pause |
| `scripts/trial-forge.ts` | E2: real trial of the forge, started by `infra/ansible/verify-engine-forge.yml` in a throwaway Node container on the orchestrator VM (depends only on `contracts.ts` and `gitea-forge.ts`): creation of a tool on the real forge, resumption, refusal of a repository that is not ours |
| `src/external/pushing-engine.ts` | **Pushing fake** (E3): agent engine without AI that pushes a set of files per code role to the task's branch (token of `svc-agent`) and returns a compliant report; sets normal, faulty (`eval()`), out of scope, conflict |
| `scripts/trial-ci.ts` | E4: real trial started by `infra/ansible/verify-engine-ci.yml` after `trial-integration.ts`: the watcher waits for the real CI of the squash's main, then reads it again; one JSON line |
| `scripts/eupadev.py`, `scripts/test_eupadev.py` | Terminal tool for people (Python stdlib): browser login with the Keycloak client `eupadev-cli` (code + PKCE, loopback), tokens in `~/.cache/eupadev/token.json` (0600), API calls; test without network (payloads, file rights, PKCE), run by the engine CI |
| `scripts/trial-integration.ts` | E3: real trial started by `infra/ansible/verify-engine-integration.yml` in the engine image (git): creation, pushes of the roles, integration, merge, resumption; one JSON line |
| `src/external/ssh-deployer.ts`, `tests/ssh-deployer.test.ts`, `scripts/trial-deployment.ts` | E5d: real deployer, one forced-command SSH call per method (refusal = `failed`, never retried; ssh failure 255 = bounded retry; served digest, never the requested one); tested against a fake `ssh` on `PATH`; lab test by `infra/ansible/verify-deployer.yml` in the engine image |
| `tests/gitea-forge.test.ts` | E2, E3, E4: the real forge against a local **fake Gitea 28** (`node:http`, answers taken from the code of Gitea 28.1.0; real Git repositories served by `git http-backend`, push rules of the robots imitated by a hook): creation, resumption on 409, repository that is not ours, 403, 5xx/429, timeout, cancellation, malformed answer, redirection, pushing fake, integration, conflict, out of scope, merge; watcher: runs, jobs, registry (scope `read:package`) |
| `tests/mails.test.ts` | E1: the SMTP adapter against a **throwaway Mailpit** (`tests/helpers/throwaway-mailpit.ts`, same image as the lab) and the migrated database: addresses, `Message-ID`, subject without header injection, replayed or simultaneous key → a single mail, sending failure → key free, requester without an address → final error; then the engine (`tests/resume/child-mails.ts`, `notifications=smtp`) **killed just after sending** the Gate 1 mail, before DBOS records the step: on restart the step is replayed under the same key and no 2nd mail goes out |
| `tests/claude-output.test.ts`, `tests/claude-engine.test.ts` | Launcher, step 4: reading of the documented JSON output (without Docker); then the engine against the real Docker and local Git repositories, with a **fake `claude`** (`tests/helpers/fake-claude/`): options, hardening seen from the inside, push, replay, stops (turns, budget, unreadable output, container killed, cancellation in under 15 s), refused work (rewritten history, merge, `.git`, forbidden path, out of scope, symbolic link, submodule, invisible name), `overlap` without a repository, proxies, signature of the image (real `cosign`, throwaway registry: unsigned or another key = refused) |
| `tests/mutations/` | **Tests that do not lie** (D2): `mutations.ts` = 205 realistic faults (1st review R01–R18, counter-review C01–C19, C09b, C11b, survivors of the targeted review X-…, 3rd round T-…, native DBOS features S1–S6, engine rights D6, engine as a service E0-…, real forge E2-…, real mails E1-…, integration E3-…, Claude Code engine E4-…, CI watcher CI-…, history purge PURGE-…, instructions INSTR-…, overlap OV-…, harness and pushed content E4-…), `launch.ts` applies them one by one on a throwaway copy and requires the expected test to fail, for the right reason |
| `features/*.feature` + `features/steps/`, `features/support/` | Gherkin scenarios run by Cucumber against the real engine + fakes (a fresh database per scenario); `hooks.ts` checks that each `@t:` tag was really traced by its scenario and, on a full run, that **every transition of the machine** was |
| `tests/helpers/` | Throwaway PostgreSQL, bench (orchestrator + fakes, injectable internal faults and freezes), **pilot** that drives a cycle up to a state along the machine's real path |
| `sql/roles.sql` | PostgreSQL accounts (idempotent, run by a superuser with `psql`): see "PostgreSQL accounts" |
| `migrations/` | `0001_schema.sql` (schema, triggers), `0002_state-machine.sql` (**generated** from `states.ts`), `0003_grants.sql` (rights of the engine) … `0007_sent-notifications.sql` (idempotency of the mails, append only), `0008_actors.sql` (identity: `actors`, `actor_identities` append only, `actor_id` on the audit tables with the name at the time of the facts, four eyes in the database), `0009_cycle-measures.sql` (view `cycle_measures`, read-only for the engine); the DBOS tables are in the `dbos` schema of the same database, installed by `src/migrate.ts` |
| `MACHINE.md` | v1 → v2 mapping + **generated** mermaid diagram |

## PostgreSQL accounts

| Account | Attributes | Use |
|---|---|---|
| superuser of the image (`orchestrator` in production) | superuser | rescue only, never used by an application |
| `orch_owner` | login only (neither superuser, nor creation of roles or databases); owner of the database, hence of the `public` schema (owned by `pg_database_owner`) | applies the migrations |
| `orch_engine` | login only; owns nothing | the engine, day to day |

`sql/roles.sql` creates the two accounts and gives the database to the owner; safe to replay (passwords in
psql variables, never in the file):
`psql -v ON_ERROR_STOP=1 -v owner_password=… -v engine_password=… -d <database> -f sql/roles.sql`. The rights of the engine are
versioned in `migrations/0003_grants.sql`: read and insert only on the append-only tables, read only on the
state machine, read, insert and update on `tools`, `cycles`, `tasks`, `cycle_memory`, `events`, no
DELETE, nothing on `pgmigrations`. The engine therefore can neither disable nor drop a trigger, nor empty a table, nor
switch to `session_replication_role = replica`, nor create a table or a schema: PostgreSQL refuses it itself. The
triggers are not `SECURITY DEFINER`: they write with the rights of the engine.

**Every new updatable table gets its explicit `GRANT UPDATE` in its migration.** By default
(`ALTER DEFAULT PRIVILEGES`), a table created by `orch_owner` in `public` can only be read and fed by
the engine: an omission shows up in the tests instead of opening a hole.

**Migration and start-up.** The engine neither creates nor changes any schema: DBOS is started with
`runMigrations: false`; it only checks the version of the `dbos` schema and refuses to start, with a clear message,
if it is missing or behind. The migration runs separately, with the owner account:
`ORCH_MIGRATION_DATABASE_URL=postgres://orch_owner:…@host/database pnpm migrate` (versioned migrations, then
`DBOS.migrate`, which gives `orch_engine` the rights on the `dbos` schema only). In production, this will be a one-off
"migrate" service of the Compose file, run before the engine.

The tests do the same: the test bench creates the accounts, migrates as `orch_owner` (`src/migrate.ts`) and starts the
engine with the URL of `orch_engine`. The setups that deliberately bypass the protections
(`unprotected`) open their own superuser connection, never the engine's.

## Commands

Prerequisites: Node ≥ 22.18, pnpm 12.16.1 (`corepack enable`, or `corepack pnpm …`), Docker for everything that touches the database, `cosign` v3.1.3 on the `PATH` for `tests/claude-engine.test.ts`.

```sh
pnpm install
pnpm typecheck      # tsc --noEmit (src, tests, scripts, features)
pnpm test           # secrets, machine + coverage of the transitions by executed scenarios + anti-loop, without a database
pnpm test:db        # throwaway PostgreSQL: schema/triggers, creation + evolution end to end on DBOS, robustness, replacement, monitoring, engine as a service (E0), real mails against a throwaway Mailpit (E1)
pnpm test:resume    # throwaway PostgreSQL: cycle killed three times (SIGKILL) and resumed
pnpm test:bdd       # Cucumber: the scenarios without @to-wire, fresh database and DBOS restarted per scenario (≈ 10 min); fails if a transition is never traced
pnpm test:all       # everything above
pnpm test:mutations # (≈ 70 min) each mutation of tests/mutations/mutations.ts must be killed by its test, for the right reason;
                    # `node tests/mutations/launch.ts R05 C10` for a few of them, `--parallel N`, `--no-witness`
pnpm generate       # regenerates the mermaid block of MACHINE.md, images/agent/check/ and images/agent/managed-settings.json
node scripts/generate-transitions.ts migrations/NNNN_state-machine.sql   # machine changed: new generated migration (new number; 0002 is never regenerated)
ORCH_MIGRATION_DATABASE_URL=… pnpm migrate  # orch_owner account: migrations + DBOS schema
EUPADEV_EXTERNAL=fake-auto ORCH_DATABASE_URL=… ADMIN_ESCALATION_ADDRESS=… TOOL_DOMAIN=… DASHBOARD_URL=… pnpm start   # orch_engine account
```

GitHub CI (`.github/workflows/engine.yml`, M4): types and tests above on each push and PR touching `orchestrator/`
(Node 22.23.4, pnpm from `packageManager`); `pnpm test:mutations` every Monday and by hand. **Ratchet**: the number of
mutations (declared on each push, killed every week) never goes below `tests/mutations/reference.json`, also read
on `main` (`tests/mutations/ratchet.ts`); a mutation added raises the reference in the same commit, removing one
takes a human commit on `main`.

Variables of `pnpm migrate`: `ORCH_MIGRATION_DATABASE_URL` (required, `orch_owner` account).

**Secrets** (`ORCH_DATABASE_URL`, `ORCH_MIGRATION_DATABASE_URL`, ROADMAP §8.16 M1): either the variable, or
`<NAME>_FILE` = path of a file that holds the value (Compose secret decrypted by `systemd-creds`, a final line
break is removed); never both (start-up refused), and the value appears in no message.

Variables of the engine: `ORCH_DATABASE_URL` (`orch_engine` account), `ADMIN_ESCALATION_ADDRESS`, `TOOL_DOMAIN`, `DASHBOARD_URL`, `OIDC_ISSUER` and `OIDC_JWKS_URL` (I0; except role `executor`), `OIDC_AUDIENCE` (`eupadev-api`), `FOUR_EYES_EXEMPTION_SUBJECT` (empty = no exemption)
(required); `EUPADEV_EXTERNAL` (required for `src/main.ts`: `fake-auto` = everything as automatic fakes, or a list
`service=implementation` separated by commas, the services not named staying automatic fakes — `forge=gitea`,
`notifications=smtp`, `engine=pushing`, `engine=claude` and `deployer=ssh` exist at this step; any other value refuses the start-up); for `engine=pushing`:
`FORGE_URL` and the token of `svc-agent`, `AGENT_TOKEN` or `AGENT_TOKEN_FILE` (scope `write:repository`), set of files
chosen by the end of the slug (`-faulty`, `-out-of-scope`, `-conflict`, otherwise normal); real test:
`infra/ansible/verify-engine-integration.yml`; Git (integration, fake): `GIT_SSL_CAINFO` for the lab's authority;
for `forge=gitea`: `FORGE_URL`
(address of the forge, https, without `/api/v1` or credentials) and the token of `svc-orchestrator` as a secret,
`FORGE_TOKEN` or `FORGE_TOKEN_FILE` (scopes `write:repository` and `write:organization`; the account must be a member
of the `agents` team and the organisation must have `repo_admin_change_team_access`, otherwise Gitea refuses to
assign the repository to it: 403; + `read:package` for the watcher, E4: without it the registry refuses the token; its
`orchestrator` team must read the Actions, `repo.actions`); real test: `infra/ansible/verify-engine-forge.yml`,
`infra/ansible/verify-engine-ci.yml` (E4); `WATCHER_CRON` (`*/30 * * * * *`, DBOS scheduling of the watcher); for `notifications=smtp`: `SMTP_URL` or
`SMTP_URL_FILE` (secret: the URL can carry the password; `smtp://mailpit:1025` on the lab, in production `smtps://…:465`
or `smtp://…:587?requireTLS=true`) and `MAIL_FROM` (sender address, domain of the `Message-ID`s); real test:
`infra/ansible/verify-engine-mails.yml`;
for `deployer=ssh` (E5d, ADR-014, only with `forge=gitea`, whose host is the registry): `DEPLOYER_HOSTS`
(`mockup=<ip>,preview=<ip>,prod=<ip>`), `DEPLOYER_KEY_FILE` (engine private key) and `DEPLOYER_KNOWN_HOSTS_FILE`
(host keys of the targets, `StrictHostKeyChecking=yes`); real test: `infra/ansible/verify-deployer.yml`;
for `engine=claude` (execution
process on the agents VM, with Docker): `FORGE_URL`, the token of `svc-agent` (`AGENT_FORGE_TOKEN` or
`AGENT_FORGE_TOKEN_FILE`), `AGENT_IMAGE` (image of the agents by digest), `AGENT_COSIGN_PUB` (cosign public key: signature of the image checked before each launch by the `cosign` of the `PATH`, ADR-013), and if needed `AGENT_RUNTIME` (`runsc` by
default), `AGENT_PROXIES` (containers attached to the internal network of each task), `AGENT_AI_PROXY` (AI proxy, `container:port`, given to the agent by its IP on the task's network), `AGENT_EGRESS_PROXY` (Smokescreen, `container:port`, given by `HTTPS_PROXY` with its IP; `NO_PROXY` = AI proxy and loopback);
`EUPADEV_ROLE` (`all-in-one`, `pilot`, `executor`: see "Pilot and executor");
`API_ADDRESS` (127.0.0.1) and `API_PORT` (8080) of the local API; `PAUSE_AGENTS` (`1`: emergency stop of the agents); `AGENT_CONCURRENCY` (N, default 1); `REPORT_SCHEMA_PATH`; `REMINDER_DELAY_MS`,
`PAUSE_ARCHIVE_DELAY_MS`, `CI_MAX_TIMEOUT_MS`, `TASK_TIMEOUT_MS`, `LONG_WAIT_DELAY_MS`,
`POLLING_INTERVAL_MS` (defaults = thresholds of `states.ts`; the tests shorten them: 24 h = 400 ms);
`LONG_REMINDER_DELAY_MS` (7 d: reminder of a gate without a decision after its 3 reminders);
`OPERATION_TIMEOUT_MS` (10 min: native timeout of an outside operation and maximum duration of a step attempt),
`MONITORING_CRON` (`0 */5 * * * *`: DBOS scheduling of the monitoring of the dead runs, 6-field cron,
seconds included; refused at start-up if invalid), `INCIDENT_RETRY_DELAY_MS` (1 min, doubled up to
60 ×: new attempt when even the incident cannot be recorded); `STEP_ATTEMPTS` (5) and
`STEP_INTERVAL_MS` (1000, doubled at each retry). Every delay, concurrency or number of attempts must be a
strictly positive integer (and ≤ 2³¹−1 ms for those that arm a timer), otherwise the start-up is refused.

**Measure per cycle** (view `cycle_measures`, migration 0009, `docs/reflexions/2026-10-16-note-mesure-cycle.md`): one
row per cycle, unknown = NULL (never 0), readable by `orch_engine`:
`SELECT tool, type, state, total_cost_usd, work_duration_min, hardening_rounds, first_ci_pass_green, gate_decisions FROM cycle_measures ORDER BY cycle_id DESC LIMIT 10;`

## As a service (E0)

**Image**: `docker build -f orchestrator/Dockerfile -t eupadev-engine .` from the **root** of the repository (the
reports schema, `tool-template/agents/report.schema.json`, is copied into the image; context filtered by
`Dockerfile.dockerignore`). Base: `node:22.23.4-trixie-slim` by digest, hardened like
`base-node:run-24` (npm/corepack/yarn removed, user `node`); not `FROM base-node:run-24`, because the engine image
is built upstream and then copied by digest to the client (§8.16 M2). Nothing is written in the image:
`read_only: true` possible (`tmpfs: /tmp` planned for the future Git clones).

```sh
# 1. migration (owner account), then 2. the engine (orch_engine account), same image
docker run --rm -e ORCH_MIGRATION_DATABASE_URL_FILE=/run/secrets/migration_url … eupadev-engine node src/migrate.ts
docker run -d --read-only --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1:8080:8080 \
  -e ORCH_DATABASE_URL_FILE=/run/secrets/engine_url -e EUPADEV_EXTERNAL=fake-auto -e API_ADDRESS=0.0.0.0 \
  -e ADMIN_ESCALATION_ADDRESS=… -e TOOL_DOMAIN=… -e DASHBOARD_URL=… … eupadev-engine
```

In a container, `API_ADDRESS=0.0.0.0` (otherwise the published port leads nowhere) and the port published on the VM's
`127.0.0.1` only. The image's health check calls `/health` (DBOS started, database reached, engine not stopped — losing
the D23 lock stops the engine). Stop: `SIGTERM` → clean stop (`DBOS.shutdown`, lock given back last).

**Outside world `fake-auto`**: agent engine, forge and deployer answer "all is well" on their own, the
notifications are written to the standard output (`fake notification → admin, cycle 3: Decision required: gate_1 …`)
and a fake watcher sends the green CI and the green Preview pipeline. Only the humans answer, through the API.

### Local API (§8.16 M8)

From Ilan's workstation, through an SSH tunnel (`ssh -N -L 8080:127.0.0.1:8080 <engine-vm>`), then `curl`. Every request carries
`X-EupaDev: 1` (otherwise 403: a web page cannot send it without a preflight request, which nothing answers) and
a local `Host` (`localhost`, `127.0.0.1`, `[::1]`, any port) or the name of `DASHBOARD_URL` (the page, behind
Caddy; otherwise 421, against DNS rebinding). The `POST`s
require `Content-Type: application/json` and `Idempotency-Key`: the key is the id of the DBOS workflow that runs the
request; replaying it returns the same result without redoing anything, reusing it with another content is refused (422).
Errors in the RFC 9457 format (`application/problem+json`, field `detail` = the exact reason): 400 invalid body
(unknown properties included), 403 someone else's cycle (reads included: only the tool's requester and admins read a
cycle and its chat), 404 unknown cycle, 409 refusal by the engine (message with no purpose in the current state…).

```sh
H=(-H 'X-EupaDev: 1' -H 'Content-Type: application/json')
curl -s "${H[@]}" http://localhost:8080/health
# → {"status":"ok","pause_agents":false}  (503 otherwise)
curl -s "${H[@]}" -H "Idempotency-Key: $(uuidgen)" http://localhost:8080/requests \
  -d '{"type":"creation","name":"Car fleet","slug":"car-fleet","requester":"ilan@example.fr","owner_service":"logistics","need":"Track the department'\''s vehicles"}'
# → 201 {"tool_id":1,"cycle_id":1,"workflow_id":"cycle-1"}   (evolution: {"type":"evolution","tool_id":1,"requester":"…"})
curl -s "${H[@]}" http://localhost:8080/requests/1
# → state, visit, gate_reason, candidate_digest, possible_decisions, status of the workflow
curl -s "${H[@]}" http://localhost:8080/requests
# → {"requests":[{"cycle_id":1,"tool_id":1,"slug":"car-fleet","name":"Car fleet","type":"creation","state":"…","created_at":"…","finished_at":null,"last_message_at":"…"}]}
#   my requests (tools.requester_id = me), newest first; an admin gets all of them
curl -s "${H[@]}" 'http://localhost:8080/requests/1/messages?since=0'
# → {"cycle_id":1,"messages":[{"id":1,"author_type":"requester","author":"ilan@example.fr","content":"Track…","created_at":"…"}]}
#   a polling page passes back the last id it got in `since` and receives only the new ones
curl -s "${H[@]}" -H "Idempotency-Key: $(uuidgen)" http://localhost:8080/messages \
  -d '{"cycle_id":1,"message":{"type":"scoping_feedback","outcome":"satisfied","author":"ilan@example.fr"}}'
# → 202 {"transmitted":true}
curl -s "${H[@]}" -H "Idempotency-Key: $(uuidgen)" http://localhost:8080/messages \
  -d '{"cycle_id":1,"message":{"type":"decision","gate":"gate_2","outcome":"approved","actor":"ilan@example.fr","digest":"sha256:…"}}'
```

Messages accepted by `POST /messages`: the humans' only — `scoping_feedback`, `preview_feedback`,
`requester_abandonment`, `requester_message`, `decision` (`gate`, `outcome`, `actor`, `comment`, `budget_top_up_usd`,
`digest` at Gate 2), `cancellation`. The forge's signals (`ci_finished`, `preview_pipeline_finished`) never come
in through the API. The identity (`author`, `actor`) is declarative as long as only Ilan has the SSH key; the OIDC
identity will come with the dashboard.

#### From the terminal with a Keycloak login (`scripts/eupadev.py`)

The `curl` lines above have no access token, which the API now requires (I0). `scripts/eupadev.py` (Python
standard library) logs a person in through the browser with the public client `eupadev-cli` (authorization code +
PKCE S256, redirect `http://127.0.0.1:<free port>/callback`), keeps the tokens in `~/.cache/eupadev/token.json`
(0600, never printed; the 5-minute access token is renewed until the Keycloak session ends, then `login` again), and
sends the API calls with the headers above and a fresh `Idempotency-Key`. Keycloak address: `https://auth.<base_domain>`
(read from `infra/ansible/group_vars/all/vars.yml`; `--auth` or `EUPADEV_AUTH` to change it); API:
`http://localhost:8080` (`--api` or `EUPADEV_API`). Each command prints the HTTP status and the JSON answer.

From the repository root, one command at a time (the tunnel in its own terminal, left running):

```sh
ssh -i ~/.ssh/eupadev_lab -o UserKnownHostsFile=~/.eupadev-known-hosts -N -L 8080:127.0.0.1:8080 ansible@10.42.0.12
python3 orchestrator/scripts/eupadev.py login
python3 orchestrator/scripts/eupadev.py submit --name "Car fleet" --slug car-fleet --service logistics --need-file need.txt
python3 orchestrator/scripts/eupadev.py show 1
python3 orchestrator/scripts/eupadev.py list
python3 orchestrator/scripts/eupadev.py history 1
```

Then, depending on what `show` says (`state`, `possible_decisions`, `candidate_digest`):

```sh
python3 orchestrator/scripts/eupadev.py health
python3 orchestrator/scripts/eupadev.py submit --tool-id 1 --need-file change.txt
python3 orchestrator/scripts/eupadev.py opinion 1 satisfied
python3 orchestrator/scripts/eupadev.py opinion 1 correction what-to-fix.txt
python3 orchestrator/scripts/eupadev.py answer 1 my-answer.txt
python3 orchestrator/scripts/eupadev.py decide 1 gate_1 approved
python3 orchestrator/scripts/eupadev.py decide 1 gate_1 correction --comment-file comment.txt
python3 orchestrator/scripts/eupadev.py decide 1 gate_2 approved --digest sha256:<candidate_digest>
```

Texts (need, answer, correction, comment) come from a UTF-8 file. The need (`need`, required) says what the tool
must do, or what to change; it becomes the first chat message of the cycle, read by the scoping agent. A retried command gets a new `Idempotency-Key`: check
with `show` before sending a `POST` again.

### Emergency stop ("engine for real" note §3.7)

1. A cycle: message `cancellation`.
2. The agents: `PAUSE_AGENTS=1`, then restart the engine (the executor, if it is separate). It then no longer listens to the
   `agent-tasks` queue (the pilot keeps `control`): no agent task
   starts, the queued ones stay there; the cycles do not die (messages and decisions go through, `/health` shows
   `"pause_agents":true`). Removing the variable and restarting starts everything again. The deadlines run during the pause.
3. The engine: `docker compose stop engine` (clean stop, everything resumes on restart).
4. The cut-off (robots' tokens deleted, etc.): Ansible recipe, outside this folder.

### One engine at a time (D23)

At start-up the engine takes a **PostgreSQL advisory lock** (`pg_try_advisory_lock`) on a dedicated connection, held
for the whole life of the process. A 2nd process on the same database **refuses to start** ("another EupaDev engine
already runs on this database") as long as the first one holds the lock. If the lock's connection is lost, the engine stops
cleanly and then the process ends (code 1) so that the supervisor restarts it — it never goes on without the lock;
each sweep also checks the connection. **Deploying = stopping the old engine, then starting the new one** (never the
two at the same time): the lock is given back last, once DBOS has stopped. One lock per role: at most one pilot and one
executor (the all-in-one takes both).

### Pilot and executor (note `docs/reflexions/2026-10-15-note-lanceur-service.md`)

Same image, role chosen by `EUPADEV_ROLE`:

| Role | Where | DBOS queues listened to | Lock (D23) | API, watcher, monitoring |
|---|---|---|---|---|
| `all-in-one` (default) | a single VM (lab before the agents VM, tests) | `control` + `agent-tasks` | both | yes |
| `pilot` | orchestrator VM | `control` | engine | yes |
| `executor` | agents VM (Docker, `engine=claude`) | `agent-tasks` | executor | no (none) |

- **Queue `control`**: all the pilot's workflows (W1, operations, API, monitoring, watcher) are started and
  scheduled there. Without it, DBOS puts a resumed workflow back in its internal queue, which any process serves, the executor included.
  Second-rank guard: a pilot workflow taken by the executor (W1 started before this queue) fails at once without
  doing anything; the pilot's monitoring resumes it through the incident gate.
- **DBOS ids**: the executor takes `agent-executor` (imposed; `DBOS__VMID` ignored). The pilot keeps its own
  (`DBOS__VMID`, `local` by default), which cannot be `agent-executor` (refused at start-up): otherwise it
  would resume on restart the tasks the executor is running. Do not change the `DBOS__VMID` of a pilot that has
  cycles in progress (they would go through the incident gate, A1).
- **Version**: constant (`PATCHING_ENABLED`, S1) on both sides; `DBOS__APPVERSION` is not used (patching
  wins). Deploy **pilot and executor together**, on the same image digest.
- **Concurrency**: `AGENT_CONCURRENCY` is written in the database by the last process started: give **the same value**
  to both (a single deployment variable).
- **Emergency stop**: `PAUSE_AGENTS=1` on the executor (or the all-in-one) suspends the agent tasks.
- Same base configuration for both (E10: `ORCH_DATABASE_URL`, `ADMIN_ESCALATION_ADDRESS`, `TOOL_DOMAIN`,
  `DASHBOARD_URL`, delays); the executor adds to it the agents' outside world (`engine=claude` and its variables).
  Without an API, its health is that of the process (it stops, code 1, if it loses its database or its lock).

### DBOS 5.2.11 defect fixed in 5.3.0: scheduling loop that outlived the shutdown

In 5.2.11, `DBOS.shutdown()` could leave a loop of the dynamic scheduler alive (a polling pass
started before the shutdown still started a new loop, never cancelled), which kept the test process alive;
the tests passed `--test-force-exit`. Fixed by the DBOS team in 5.3.0 (PR dbos-inc/dbos-transact-ts#1390:
"an abandoned backfill means shutdown began; a loop started now would outlive destroy()"). The engine moved to
5.3.0 on 2026-10-16: the reproduction `node tests/helpers/scheduler-repro.ts` ends on its own (5 tries out of 5) and
`--test-force-exit` is removed from the scripts and the mutations (full suite and 237 mutations green without it).

### Updating the code (DBOS patching, S1)

The engine enables DBOS **patching** (`enablePatching`): the application version is constant (`PATCHING_ENABLED`),
never computed from the source. A restart with new code **resumes the workflows in progress in place** (DBOS
replays them from their recorded steps): no cycle goes through the incident gate because of a deployment.

**When to use `DBOS.patch`**: only when the change alters the **sequence of steps** already recorded by a
workflow in progress (a step added, removed, renamed or moved in W1, W2 or an operation), otherwise the replay of the old
workflow stops on a non-determinism error. Changing the content of a step (query, text, computation in
`step(...)`), adding a state or a database function needs nothing. The memory in the database (D22) limits the need: W1
reads its state again at each round.

```ts
if (await DBOS.patch('add-preview-health-check')) {
  await step('Preview health check', () => …);   // new code: workflows started after the deployment
}                                                  // otherwise: old path, workflows started before
```

**Removing a patch**, in three deployments: (1) `DBOS.patch('x')` as above; (2) when no workflow
started before the patch is in progress any more (`DBOS.listWorkflows({ status: ['PENDING', 'ENQUEUED'], endTime: <date of the patch's deployment> })`), replace
it with `await DBOS.deprecatePatch('x')` and delete the old path; (3) when no workflow started with `patch` is
in progress any more, delete the call itself. Never redeploy code older than a patch already seen by a workflow.

**Only the runs that are really dead go through the incident gate**: W1 in ERROR (e.g. non-determinism of a forgotten
patch), CANCELLED (cancelled from outside — the business cancellation, for its part, ends the cycle), MAX_RECOVERY_ATTEMPTS_EXCEEDED,
or waiting at an executor (`DBOS__VMID`) that this engine will never resume. The monitoring stops its children, puts
the cycle at the incident gate, alerts the admin and **resumes the W1 from the start under the same id**
(`DBOS.rewindWorkflow`): it reads the state and the memory in the database again. The messages it had not read are lost; the state
resumed after "retry" **asks for them again** (S5). The deadlines (pause 30 d, CI 60 min…) and the reminders already sent
count from the **first** entry into the state: going through the incident gate does not reset them (G5).

## How it runs

- **One cycle = one W1 workflow** (`cycle-<id>`, the same id if it had to be resumed), started on
  request. It reads the state **and its memory** in the database, processes the current state, writes the transition (UPDATE checked by the
  trigger) with the memory in the same transaction, and starts again until an end. Each read, write and outside
  call is a DBOS step: after a hard stop, the workflow resumes at the last finished step, nothing is
  replayed twice.
- **No volatile memory** (D22): instruction, admin's clarification, message received during the pause, candidate digest, gate
  reason, scoping counters, "reviewer only" round live in `cycle_memory`; reminders already sent and
  deadlines are read in the history (date of entry into the state); tasks and operations in progress in DBOS (children
  of the W1). A W1 resumed from the start therefore picks up exactly where it was.
- **The messages of the humans and of the forge arrive in a single mailbox** (`DBOS.recv`): the requester's feedback, the admin's
  decisions (`decision:<gate>`), the forge's signals. **Tasks (W2) and outside operations are child
  workflows** whose native end W1 waits for (`DBOS.waitAll`, then status and output: S4); an operation has a native timeout
  (`startWorkflow(…, { timeoutMS })`, S3). The cancellation is handled everywhere: `send` delivers it, then cancels the children,
  which wakes W1 up during a task or a deployment (tasks closed at the cap, E15).
- **The gates**: notification, durable wait, reminders at 24/48/72 h (`timeout_exceeded` traces in the
  history), then **one reminder a week** until the decision (S6, notification only); the decision writes
  `approvals` in the same transaction as the transition; a top-up raises the cap of the cycle.
- **The delays** are durable deadlines (`deadlineEpochMS`): they survive restarts. **Rule**: deadlines
  and reminders count from the **first entry** into the state (the pass); a round trip through the incident gate
  (`resume:<state>`) or the resumption of a dead workflow resets neither the deadline nor the reminder counter (G5).
- **No silent death** (D21): each step that touches the database or a service is retried with a growing
  wait, each attempt has a maximum duration; beyond that, or on any unexpected error, W1 stops what is running,
  notifies the admin with the exact error and moves to `gate_incident`, whose "retry" goes back only to the state of origin
  (checked by the database) and really restarts the work (failed task → new attempt `-r<n>`, successful task
  kept). A silent outside operation is cancelled by DBOS at its timeout and counts as an error towards the planned gate of the
  state. W1 always sees the end of a child (native status): a W2 in ERROR or cancelled leaves a task closed as failed at the
  cap. At start-up and then by the scheduled task, a cycle without a live workflow is restarted or put at the incident and
  its W1 resumed; `send` to a dead workflow triggers the same resumption. An end cleanup that fails ends in an admin alert; it touches only the
  cycle's resources (cycle id: mock-up, Preview, branches `agent/<tool>/<cycle>/…`), never those of a
  later cycle (G4); the monitoring removes what would still be served for a finished cycle or an archived tool (alert).
- **Idempotent effects (M9)**: a step attempt that goes past its timeout can go on in the background; the effects
  that count are not doubled: each notification carries a key (workflow + step + subject) that the sending service deduplicates,
  a deployment is idempotent for (environment, tool, digest) and each outside operation is a step
  run only once (no DBOS retry), a deployment recorded once per operation.
- **Messages**: validated in full at entry (otherwise refused to the caller), then marked with the current pass in
  the state (`visit`): a double send is applied only once, even if the cycle goes through the same gate again.
- **W2**: the `agent-tasks` queue has N places (environment variable) and at most 3 per tool
  (partition per tool, capped at N). The budget is checked by W1 once per round (D11), traced
  in `tool_history` (`check:budget:…`).
- **Hardening counters** (D15/D20) derived from the tables at the evaluation and at the entry of the round:
  `deviations` since the last "continue" decision (date of the transition
  `gate_hardening_blocked → hardening_execution`), `tasks.tree_hash`, `tasks.duration_s`,
  `tasks.cost_usd`. The scoping counters (same error ×3, 5 attempts) live in the workflow's memory,
  in the database (D22).
- **Fakes**: the engine waits for the answer scripted by the test for each task (prepared in
  advance or given during the wait); the forge and the deployer likewise; the notifications are
  logged. The tests' pilot drives a cycle up to a given state by answering "all is
  well" (or by a planned detour to reach a gate), always along the real path.

## Rules of the folder

- The machine is described in one place only: `states.ts`. Never change by
  hand `0002_state-machine.sql` or the generated block of `MACHINE.md`; `pnpm test`
  fails if they are no longer up to date.
- Every transition added to `states.ts` must have its scenario in `features/`
  (tag `@t:`), otherwise `pnpm test` fails; a tag that no longer matches
  a transition also makes the test fail. Same sentence = same step: reuse the
  existing wordings before inventing one. A scenario without step definitions
  carries `@to-wire` (excluded from `pnpm test:bdd`, counted by `pnpm test`).
- An applied migration is not changed: if the machine changes after a release
  to production, generate a **new** migration.
- A change of state is made by a single `UPDATE cycles SET state, last_trigger,
  last_actor_id` (`Database.transition`); the database refuses any (current state, trigger) pair missing
  from `allowed_transitions`. The code never bypasses the trigger, the tests neither (the pilot
  drives the cycles along the real path).
- Nothing reads the free text or the line of a deviation: identity `rule` + `file`, then `category` +
  `file`, then `previous_id` (`src/hardening/stagnation.ts`). A report outside the schema is invalid
  (failed task, deviation `report:<role>`).
- No end deletes data (§8.13 D7): a creation that ends without
  success archives the tool (`tools.archived_at`, set by the database) and asks the admin
  to archive the repository (§8.16 M5: the engine no longer administers the repository; no
  branch is deleted); an evolution that stops leaves the tool in prod intact.
- Dependencies: MIT / Apache / ISC / BSD licences only, exact versions in `package.json`
  and `pnpm-lock.yaml` (never `npm install`). DBOS (`@dbos-inc/dbos-sdk`, MIT) is used through its
  public functional API (`registerWorkflow`, `runStep`, `recv`/`send`, `startWorkflow`, `waitAll`, `listWorkflows`,
  `getWorkflowStatus`, `cancelWorkflows`, `rewindWorkflow`, `applySchedules`, patching), without decorators, hence without
  transpilation; **what DBOS does natively is not coded again** (ROADMAP §8.14) and the engine never reads or writes
  the internal tables `dbos.*` (only the tests do, in setups).
- Protected database (B9, M8): append-only tables (UPDATE, DELETE and TRUNCATE refused); type, tool, trigger and
  budgets of a cycle, `tools.current_state` out of reach except through the machine (budget: only by an approved
  top-up, in the same transaction as the approval transition, applied by a trigger); approval only at
  the gate where the cycle is, and at Gate 2 only on the candidate digest; Prod only from a digest approved at
  Gate 2 (a failed row can trace another digest really served, M5); transition history row
  written only by the trigger (the resumption check cannot be fooled); in-place loop only if
  `allowed_transitions` provides for it; `tasks` never deleted, cost set only once at closing, closed task
  immutable; `cycle_memory` written only with a transition of the cycle; a single creation cycle per tool. The
  tests that must set up a situation outside these paths do it through `unprotected` (triggers suspended for the time
  of a transaction, a right of the throwaway PostgreSQL's superuser only), never the code.
- Tests: a checkable rule has its test, and `pnpm test:mutations` proves that the test fails when the rule is broken.
  Every new rule adds its mutation to `tests/mutations/mutations.ts`.
- Not planned at this step, on purpose: real implementations of the outside world
  (Claude Code, Gitea, real W4, mail), Conductor, W5–W7, dashboard.
