-- Up Migration
-- Schema of the orchestrator (ROADMAP §8.5 + additions §8.13). v1 lessons applied:
--  E1  : identity required everywhere (NOT NULL + foreign keys, including the composite key
--        (cycle_id, tool_id) that forbids attaching a row to the cycle of another tool);
--  E4/5: deterministic and unique task id;
--  §8.13: the database itself refuses an unplanned transition (trigger) and writes the history.
-- The tables `states` and `allowed_transitions` are filled by the migration generated
-- from src/machine/states.ts (scripts/generate-transitions.ts), never by hand.

CREATE TABLE states (
  id          text PRIMARY KEY,
  phase       text NOT NULL CHECK (phase IN ('entry', 'scoping', 'contract', 'hardening', 'delivery', 'cross_cutting', 'end')),
  kind        text NOT NULL CHECK (kind IN ('active', 'waiting', 'gate', 'end')),
  description text NOT NULL
);

CREATE TABLE allowed_transitions (
  from_state text NOT NULL REFERENCES states (id),
  trigger    text NOT NULL,
  to_state   text NOT NULL REFERENCES states (id),
  note       text NOT NULL,
  PRIMARY KEY (from_state, trigger)
);

CREATE TABLE tools (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Displayed name (mail subjects, dashboard): neither line break nor control character (header injection).
  name             text NOT NULL CHECK (btrim(name) <> '' AND name !~ '[[:cntrl:]]'),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  requester        text NOT NULL CHECK (btrim(requester) <> ''),
  owner_service    text NOT NULL CHECK (btrim(owner_service) <> ''),
  -- Denormalisation (§8.5) kept up to date by the cycles trigger; NULL while there is no cycle.
  current_state    text REFERENCES states (id),
  current_cycle_id bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Final archiving (decisions 1 and 9): set by the cycles trigger when a creation cycle
  -- ends other than in success. Never deleted; no new cycle afterwards.
  archived_at      timestamptz
);

CREATE TABLE cycles (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id              bigint NOT NULL REFERENCES tools (id),
  type                 text NOT NULL CHECK (type IN ('creation', 'evolution')),
  -- Budget per cycle (D2); an approved top-up raises these caps and is traced in approvals.
  scoping_budget_usd   numeric(10, 2) NOT NULL CHECK (scoping_budget_usd > 0),
  hardening_budget_usd numeric(10, 2) NOT NULL CHECK (hardening_budget_usd > 0),
  state                text NOT NULL DEFAULT 'request_received' REFERENCES states (id),
  -- Set in the same UPDATE as `state`; the trigger requires them and copies them into the history.
  last_trigger         text,
  last_actor           text NOT NULL CHECK (btrim(last_actor) <> ''),
  created_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  UNIQUE (id, tool_id)
);
-- A single cycle in progress per tool: creation and evolution do not overlap on main.
CREATE UNIQUE INDEX cycles_one_in_progress ON cycles (tool_id) WHERE finished_at IS NULL;
CREATE INDEX cycles_state ON cycles (state);

ALTER TABLE tools ADD CONSTRAINT tools_current_cycle_fk FOREIGN KEY (current_cycle_id) REFERENCES cycles (id);

CREATE TABLE tool_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id        bigint NOT NULL REFERENCES tools (id),
  cycle_id       bigint NOT NULL REFERENCES cycles (id),
  previous_state text REFERENCES states (id),
  state          text NOT NULL REFERENCES states (id),
  trigger        text NOT NULL,
  actor          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, tool_id) REFERENCES cycles (id, tool_id)
);
CREATE INDEX tool_history_cycle ON tool_history (cycle_id, created_at);
CREATE INDEX tool_history_tool ON tool_history (tool_id, created_at);

CREATE TABLE tasks (
  -- Deterministic id `<tool>-<cycle>-<iteration>-<role>` (E4/E5), suffixed `-r<n>` from the
  -- 2nd attempt on ("retry" after an incident really runs the task again, B3); name of the throwaway container.
  id                  text PRIMARY KEY,
  tool_id             bigint NOT NULL REFERENCES tools (id),
  cycle_id            bigint NOT NULL REFERENCES cycles (id),
  step                text NOT NULL REFERENCES states (id),
  role                text NOT NULL CHECK (role IN ('overlap', 'scoping', 'contract', 'backend', 'frontend', 'tests', 'integration', 'security-reviewer', 'quality-reviewer')),
  iteration           integer NOT NULL CHECK (iteration >= 1),
  -- B3: attempt of the task for (cycle, iteration, role); the most recent one counts for the round.
  attempt             integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  -- B7: runs of the engine for this task (a resume after a fault in the middle of a run runs it again);
  -- every lost run counts at the task's cap in cost_usd.
  executions          integer NOT NULL DEFAULT 0 CHECK (executions >= 0),
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'in_progress', 'done', 'blocked', 'failed')),
  branch              text,
  -- Real cost measured by the orchestrator; unknown cost (interrupted task) = the task's cap, never 0.
  cost_usd            numeric(10, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  input_tokens        bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens       bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  duration_s          integer NOT NULL DEFAULT 0 CHECK (duration_s >= 0),
  -- Report in the agents/report.schema.json format (deviations `rule` + `file` for the stagnation).
  report              jsonb,
  -- Manifest of the files (hash) for the review limited to the diff.
  manifest            jsonb,
  -- Digest of the dependencies (SBOM) for the diff shown at Gate 2 (D5).
  dependencies_digest text,
  -- D20 M4: digest of the Git tree of the role's directories after the task
  -- (sha256 of `git ls-tree <commit> -- <paths of the role>`, src/hardening/stagnation.ts PATHS_BY_ROLE).
  -- Unchanged from one round to the next = deviation `code:unchanged:<role>`; equal to an earlier round = oscillation, escalation.
  tree_hash           text CHECK (tree_hash ~ '^[0-9a-f]{64}$'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  ended_at            timestamptz,
  FOREIGN KEY (cycle_id, tool_id) REFERENCES cycles (id, tool_id),
  CONSTRAINT tasks_deterministic_id CHECK (id = tool_id::text || '-' || cycle_id::text || '-' || iteration::text || '-' || role
                                           || CASE WHEN attempt = 1 THEN '' ELSE '-r' || attempt::text END),
  CONSTRAINT tasks_tree_hash_code_role CHECK (tree_hash IS NULL OR role IN ('backend', 'frontend', 'tests')),
  CONSTRAINT tasks_report_if_finished CHECK (status NOT IN ('done', 'blocked') OR report IS NOT NULL),
  -- blocked = failed for the machine, but the reason must exist to be shown to the admin (decision 7).
  CONSTRAINT tasks_blocked_with_reason CHECK (status <> 'blocked' OR btrim(coalesce(report ->> 'blocked_reason', '')) <> '')
);
CREATE INDEX tasks_cycle ON tasks (cycle_id, created_at);
CREATE INDEX tasks_tool ON tasks (tool_id);
CREATE INDEX tasks_status ON tasks (status) WHERE status IN ('queued', 'in_progress');

CREATE TABLE approvals (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id           bigint NOT NULL REFERENCES tools (id),
  cycle_id          bigint NOT NULL REFERENCES cycles (id),
  gate              text NOT NULL REFERENCES states (id),
  -- An approval is about a digest, not a tool (required at Gate 2).
  digest            text CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  -- scope_change: fourth button of Gate 1 only (decision 2).
  decision          text NOT NULL CHECK (decision IN ('approved', 'correction', 'refused', 'scope_change')),
  -- Top-up (D2): only with "approved"; raises the cycle's cap.
  budget_top_up_usd numeric(10, 2) CHECK (budget_top_up_usd > 0),
  actor             text NOT NULL CHECK (btrim(actor) <> ''),
  comment           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, tool_id) REFERENCES cycles (id, tool_id),
  CONSTRAINT approvals_gate2_digest CHECK (gate <> 'gate_2' OR digest IS NOT NULL),
  CONSTRAINT approvals_correction_commented CHECK (decision NOT IN ('correction', 'scope_change') OR btrim(coalesce(comment, '')) <> ''),
  CONSTRAINT approvals_top_up_if_approved CHECK (budget_top_up_usd IS NULL OR decision = 'approved'),
  CONSTRAINT approvals_gate1_scope CHECK (decision <> 'scope_change' OR gate = 'gate_1')
);
CREATE INDEX approvals_cycle ON approvals (cycle_id, created_at);
CREATE INDEX approvals_tool_gate ON approvals (tool_id, gate);

CREATE TABLE deployments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id     bigint NOT NULL REFERENCES tools (id),
  cycle_id    bigint NOT NULL REFERENCES cycles (id),
  environment text NOT NULL CHECK (environment IN ('mockup', 'preview', 'prod', 'quarantine')),
  digest      text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  url         text,
  health      text NOT NULL DEFAULT 'unknown' CHECK (health IN ('ok', 'failed', 'unknown')),
  -- Visit to the deployment state (history row of the entry, B8).
  visit       bigint NOT NULL REFERENCES tool_history (id),
  -- G3: deployment operation (id of the child workflow `op-<cycle>-…`): one row per deployment really
  -- attempted, even if the step that writes it is retried (B8); a new try in the same visit has its own row, so
  -- the last row always tells what is served (never a stale digest presented at Gate 2).
  operation   text NOT NULL CHECK (btrim(operation) <> ''),
  deployed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, tool_id) REFERENCES cycles (id, tool_id),
  CONSTRAINT deployments_one_per_operation UNIQUE (operation)
);
CREATE INDEX deployments_tool_env ON deployments (tool_id, environment, deployed_at DESC);

-- Results of the CI and of the Preview pipeline, one per check (decision 11): a red one sends
-- back to hardening automatically with these rows in the context; at the "hardening
-- blocked" gate the admin sees which check fails, its result and for how many rounds (iteration).
CREATE TABLE pipeline_results (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id    bigint NOT NULL REFERENCES tools (id),
  cycle_id   bigint NOT NULL REFERENCES cycles (id),
  -- Hardening round whose code this result judges.
  iteration  integer NOT NULL CHECK (iteration >= 1),
  pipeline   text NOT NULL CHECK (pipeline IN ('ci', 'preview')),
  -- NULL only for a red CI (no image built).
  digest     text CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  check_name text NOT NULL CHECK (btrim(check_name) <> ''),
  result     text NOT NULL CHECK (result IN ('green', 'red')),
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- B8: visit to the waiting state (history row of the entry): one result per check and per visit,
  -- even if the step that writes it is retried.
  visit      bigint NOT NULL REFERENCES tool_history (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, tool_id) REFERENCES cycles (id, tool_id),
  CONSTRAINT pipeline_results_digest CHECK (digest IS NOT NULL OR (pipeline = 'ci' AND result = 'red')),
  CONSTRAINT pipeline_results_one_per_pass UNIQUE (cycle_id, visit, pipeline, check_name)
);
CREATE INDEX pipeline_results_cycle ON pipeline_results (cycle_id, iteration);

-- Deduplicated deviations of a hardening round (D20, E9): one row per (rule, file) and per round, whatever
-- their source (reviewers: `tasks.report.findings`; orchestrator: `ci:<check>`,
-- `ci:opengrep:<matchBasedId>`, `preview:<check>`, `scope:<file>`, `report:<role>`,
-- `code:unchanged:<role>`). The deduplication by (rule, file) is the UNIQUE constraint, not code.
-- The counters (rule+file, category+file, previous_id, patience) are derived from this table per
-- cycle and round (src/hardening/stagnation.ts); the admin reads "for how many rounds" there.
CREATE TABLE deviations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id     bigint NOT NULL REFERENCES tools (id),
  cycle_id    bigint NOT NULL REFERENCES cycles (id),
  iteration   integer NOT NULL CHECK (iteration >= 1),
  rule        text NOT NULL CHECK (btrim(rule) <> ''),
  file        text NOT NULL CHECK (btrim(file) <> ''),
  -- Category from the closed list of the report schema; NULL for the orchestrator's deviations.
  category    text CHECK (category IS NULL OR btrim(category) <> ''),
  -- M7: `id` of the finding in the report and `previous_id` declared by the reviewer (information, 3rd tier).
  finding_id  text CHECK (finding_id IS NULL OR btrim(finding_id) <> ''),
  previous_id text CHECK (previous_id IS NULL OR btrim(previous_id) <> ''),
  source      text NOT NULL CHECK (source IN ('overlap', 'scoping', 'contract', 'backend', 'frontend', 'tests', 'integration', 'security-reviewer', 'quality-reviewer', 'orchestrator')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, tool_id) REFERENCES cycles (id, tool_id),
  CONSTRAINT deviations_one_per_digest_and_round UNIQUE (cycle_id, iteration, rule, file),
  CONSTRAINT deviations_previous_id_reviewer CHECK (previous_id IS NULL OR source IN ('security-reviewer', 'quality-reviewer'))
);
CREATE INDEX deviations_cycle_round ON deviations (cycle_id, iteration);

CREATE TABLE messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id     bigint NOT NULL REFERENCES tools (id),
  cycle_id    bigint NOT NULL REFERENCES cycles (id),
  author_type text NOT NULL CHECK (author_type IN ('requester', 'admin', 'agent', 'orchestrator')),
  author      text NOT NULL CHECK (btrim(author) <> ''),
  content     text NOT NULL CHECK (btrim(content) <> ''),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, tool_id) REFERENCES cycles (id, tool_id)
);
CREATE INDEX messages_cycle ON messages (cycle_id, created_at);

-- D22: memory of the W1 workflow (instruction, admin's clarification, pending message, candidate digest, gate
-- reason, scoping counters…), written in the SAME transaction as each transition. W1 reads it back at each state:
-- a new workflow (sweep, new version) resumes exactly where the old one was; nothing lives only in memory.
CREATE TABLE cycle_memory (
  cycle_id   bigint PRIMARY KEY REFERENCES cycles (id),
  memory     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Outbox (§8.11 no. 5): filled in the same transaction as the state change.
CREATE TABLE events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id    bigint NOT NULL REFERENCES tools (id),
  cycle_id   bigint REFERENCES cycles (id),
  type       text NOT NULL CHECK (btrim(type) <> ''),
  payload    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'failed')),
  attempts   integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz
);
CREATE INDEX events_to_dispatch ON events (created_at) WHERE status = 'pending';

-- ── Triggers ──────────────────────────────────────────────────────────────────

CREATE FUNCTION refuse_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % refused', TG_TABLE_NAME, TG_OP;
END
$$;
CREATE TRIGGER tool_history_append_only BEFORE UPDATE OR DELETE ON tool_history
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER approvals_append_only BEFORE UPDATE OR DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER deviations_append_only BEFORE UPDATE OR DELETE ON deviations
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER deployments_append_only BEFORE UPDATE OR DELETE ON deployments
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER pipeline_results_append_only BEFORE UPDATE OR DELETE ON pipeline_results
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER messages_append_only BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
-- B9: TRUNCATE (cascading from tools or cycles included) refused on the append-only tables.
CREATE TRIGGER tool_history_no_truncate BEFORE TRUNCATE ON tool_history FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER approvals_no_truncate BEFORE TRUNCATE ON approvals FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER deviations_no_truncate BEFORE TRUNCATE ON deviations FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER deployments_no_truncate BEFORE TRUNCATE ON deployments FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER pipeline_results_no_truncate BEFORE TRUNCATE ON pipeline_results FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER messages_no_truncate BEFORE TRUNCATE ON messages FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

CREATE FUNCTION approvals_verify_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM states WHERE id = NEW.gate) IS DISTINCT FROM 'gate' THEN
    RAISE EXCEPTION 'approval on a state that is not a gate: %', NEW.gate;
  END IF;
  -- B9: a decision is made only at the gate where the cycle is (the approval precedes the transition, same transaction).
  IF (SELECT state FROM cycles WHERE id = NEW.cycle_id) IS DISTINCT FROM NEW.gate THEN
    RAISE EXCEPTION 'approval refused: cycle % is not at gate %', NEW.cycle_id, NEW.gate;
  END IF;
  -- M8: a Gate 2 decision is about the candidate digest, the one of the cycle's last Preview deployment if it is
  -- healthy (same rule as Database.candidateDigest); never another one.
  -- (Digest missing or malformed: left to the table's constraints, which say so.)
  IF NEW.gate = 'gate_2' AND NEW.digest ~ '^sha256:[0-9a-f]{64}$' AND NEW.digest IS DISTINCT FROM (
    SELECT CASE WHEN d.health = 'ok' THEN d.digest END FROM deployments d
    WHERE d.cycle_id = NEW.cycle_id AND d.environment = 'preview' ORDER BY d.id DESC LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Gate 2 approval refused: % is not the candidate digest of cycle %', NEW.digest, NEW.cycle_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER approvals_gate BEFORE INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION approvals_verify_gate();

-- History row written by the current transaction (transition or trace) for this cycle: used to require that a
-- write happens only with a transition of the machine (M8). xmin is the 32-bit id of the transaction.
CREATE FUNCTION transition_in_this_transaction(cycle bigint, from_state text DEFAULT NULL, trigger text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM tool_history h
    WHERE h.cycle_id = cycle AND h.xmin::text = (txid_current() % 4294967296)::text
      AND (from_state IS NULL OR (h.previous_state = from_state AND h.state <> from_state))
      AND (transition_in_this_transaction.trigger IS NULL OR h.trigger = transition_in_this_transaction.trigger)
  )
$$;

-- M8: a top-up exists only with the approval transition of its gate ("approved"), in the same transaction;
-- checked at commit (deferred constraint), since the approval is written just before the transition.
CREATE FUNCTION approvals_top_up_with_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.budget_top_up_usd IS NOT NULL AND NOT transition_in_this_transaction(NEW.cycle_id, NEW.gate, 'gate:approved') THEN
    RAISE EXCEPTION 'top-up refused: only with the "approved" transition of gate % of cycle % (same transaction)', NEW.gate, NEW.cycle_id;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER approvals_top_up_transition AFTER INSERT ON approvals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION approvals_top_up_with_transition();

-- B9 / D2: an approved top-up raises the envelope of its gate's phase (scoping; contract and hardening);
-- it is the only path that changes a budget (cycles_protect refuses any other UPDATE of the budgets).
CREATE FUNCTION approvals_apply_top_up() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  gate_phase text := (SELECT phase FROM states WHERE id = NEW.gate);
BEGIN
  IF NEW.budget_top_up_usd IS NULL THEN
    RETURN NULL;
  END IF;
  IF gate_phase = 'scoping' THEN
    UPDATE cycles SET scoping_budget_usd = scoping_budget_usd + NEW.budget_top_up_usd WHERE id = NEW.cycle_id;
  ELSIF gate_phase IN ('contract', 'hardening') THEN
    UPDATE cycles SET hardening_budget_usd = hardening_budget_usd + NEW.budget_top_up_usd WHERE id = NEW.cycle_id;
  ELSE
    RAISE EXCEPTION 'top-up irrelevant at gate % (no budget envelope)', NEW.gate;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER approvals_top_up AFTER INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION approvals_apply_top_up();

-- B9: the Prod receives only a digest approved at Gate 2 of this cycle (D19). M5: a failed row traces what
-- the deployer really served (even another digest); it is never a reference of a healthy Prod.
CREATE FUNCTION deployments_verify_prod() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.environment = 'prod' AND NEW.health <> 'failed' AND NOT EXISTS (
    SELECT 1 FROM approvals WHERE cycle_id = NEW.cycle_id AND gate = 'gate_2' AND decision = 'approved' AND digest = NEW.digest
  ) THEN
    RAISE EXCEPTION 'prod deployment refused: digest % was not approved at Gate 2 of cycle %', NEW.digest, NEW.cycle_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER deployments_prod BEFORE INSERT ON deployments
  FOR EACH ROW EXECUTE FUNCTION deployments_verify_prod();

-- B9: a history row that describes a transition (or the creation) is written only by the cycles trigger;
-- by hand, only a trace on the current state is possible (budget check, cleanup, or repeat in place allowed
-- by allowed_transitions). The resume check (last `incident` row) therefore cannot be fooled.
CREATE FUNCTION history_verify_insertion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() >= 2 THEN
    RETURN NEW; -- written by cycles_write_history
  END IF;
  IF NEW.previous_state IS DISTINCT FROM NEW.state OR NEW.state IS DISTINCT FROM (SELECT state FROM cycles WHERE id = NEW.cycle_id) THEN
    RAISE EXCEPTION 'history: a transition is written only by the machine (cycle %, % -> %)', NEW.cycle_id, NEW.previous_state, NEW.state;
  END IF;
  IF NEW.trigger LIKE 'check:%' OR NEW.trigger LIKE 'cleanup:%' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM allowed_transitions WHERE from_state = NEW.state AND trigger = NEW.trigger AND to_state = NEW.state) THEN
    RAISE EXCEPTION 'repeat in place not allowed by the machine: % --[%]--> % (cycle %)', NEW.state, NEW.trigger, NEW.state, NEW.cycle_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER history_insertion BEFORE INSERT ON tool_history
  FOR EACH ROW EXECUTE FUNCTION history_verify_insertion();

-- Every state change of a cycle must be a transition of the machine.
CREATE FUNCTION cycles_verify_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_trigger IS NULL THEN
    RAISE EXCEPTION 'state change without a trigger (cycle %, % -> %)', NEW.id, OLD.state, NEW.state;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM allowed_transitions
    WHERE from_state = OLD.state AND trigger = NEW.last_trigger AND to_state = NEW.state
  ) THEN
    RAISE EXCEPTION 'transition not allowed by the machine: % --[%]--> % (cycle %)', OLD.state, NEW.last_trigger, NEW.state, NEW.id;
  END IF;
  -- D21: "retry" at the incident gate only goes back to the state the incident comes from (last incident row).
  IF OLD.state = 'gate_incident' AND NEW.last_trigger LIKE 'resume:%' AND NEW.state IS DISTINCT FROM (
    SELECT h.previous_state FROM tool_history h
    WHERE h.cycle_id = NEW.id AND h.state = 'gate_incident' AND h.trigger = 'incident' ORDER BY h.id DESC LIMIT 1
  ) THEN
    RAISE EXCEPTION 'resume to % refused: the incident of cycle % does not come from that state', NEW.state, NEW.id;
  END IF;
  -- finished_at is set only by the arrival in an end, never by hand (cycles_protect for the other UPDATEs).
  NEW.finished_at := OLD.finished_at;
  IF (SELECT kind FROM states WHERE id = NEW.state) = 'end' THEN
    NEW.finished_at := now();
    -- Decisions 1 and 9: a creation that does not end in success archives the tool (final);
    -- an evolution that stops leaves the tool in prod intact.
    IF NEW.type = 'creation' AND NEW.state <> 'end_success' THEN
      UPDATE tools SET archived_at = coalesce(archived_at, now()) WHERE id = NEW.tool_id;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cycles_transition BEFORE UPDATE OF state ON cycles
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION cycles_verify_transition();

-- Creation of a cycle: always in the initial state, open; never on an archived tool (final archive, decision 1).
CREATE FUNCTION cycles_verify_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM 'request_received' OR NEW.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'a cycle is born in state request_received, open (received: %, finished_at %)', NEW.state, NEW.finished_at;
  END IF;
  IF (SELECT archived_at FROM tools WHERE id = NEW.tool_id) IS NOT NULL THEN
    RAISE EXCEPTION 'tool % archived: no new cycle possible', NEW.tool_id;
  END IF;
  -- M8: a tool has only one creation cycle, the first; then only evolutions.
  IF NEW.type = 'creation' AND EXISTS (SELECT 1 FROM cycles WHERE tool_id = NEW.tool_id) THEN
    RAISE EXCEPTION 'tool %: a single creation cycle, the first one (a request on an existing tool is an evolution)', NEW.tool_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cycles_creation BEFORE INSERT ON cycles
  FOR EACH ROW EXECUTE FUNCTION cycles_verify_creation();

-- finished_at changes only through a transition to an end (cycles_verify_transition). B9: type and tool
-- immutable; last trigger and actor only with a state change; budgets only through an approved
-- top-up (trigger approvals_top_up, depth ≥ 2).
CREATE FUNCTION cycles_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state AND NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
    RAISE EXCEPTION 'cycles.finished_at is set by the machine (arrival in an end), never by hand (cycle %)', NEW.id;
  END IF;
  IF NEW.type IS DISTINCT FROM OLD.type OR NEW.tool_id IS DISTINCT FROM OLD.tool_id THEN
    RAISE EXCEPTION 'cycles.type and cycles.tool_id are immutable (cycle %)', NEW.id;
  END IF;
  IF NEW.state IS NOT DISTINCT FROM OLD.state AND (NEW.last_trigger IS DISTINCT FROM OLD.last_trigger OR NEW.last_actor IS DISTINCT FROM OLD.last_actor) THEN
    RAISE EXCEPTION 'cycles.last_trigger and last_actor only change with a transition (cycle %)', NEW.id;
  END IF;
  IF (NEW.scoping_budget_usd IS DISTINCT FROM OLD.scoping_budget_usd OR NEW.hardening_budget_usd IS DISTINCT FROM OLD.hardening_budget_usd) AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'budget of cycle % changes only through an approved top-up (approvals)', NEW.id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cycles_protection BEFORE UPDATE ON cycles
  FOR EACH ROW EXECUTE FUNCTION cycles_protect();

-- tools.archived_at is set only by the cycles trigger (end of a creation other than success), and never removed.
CREATE FUNCTION tools_protect_archiving() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL OR NEW.current_state IS NOT NULL OR NEW.current_cycle_id IS NOT NULL THEN
      RAISE EXCEPTION 'a tool is born unarchived, with no current state or cycle';
    END IF;
  ELSIF NEW.archived_at IS DISTINCT FROM OLD.archived_at AND (pg_trigger_depth() < 2 OR OLD.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'tools.archived_at is set by the machine (end of a creation other than success), never by hand nor removed (tool %)', NEW.id;
  ELSIF (NEW.current_state IS DISTINCT FROM OLD.current_state OR NEW.current_cycle_id IS DISTINCT FROM OLD.current_cycle_id) AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'tools.current_state and current_cycle_id are kept by the machine, never by hand (tool %)', NEW.id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tools_archiving BEFORE INSERT OR UPDATE ON tools
  FOR EACH ROW EXECUTE FUNCTION tools_protect_archiving();

-- Every accepted change (and the creation) writes the history and updates the tool.
CREATE FUNCTION cycles_write_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = NEW.state THEN
    RETURN NULL;
  END IF;
  INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor)
  VALUES (
    NEW.tool_id, NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state,
    CASE WHEN TG_OP = 'INSERT' THEN 'cycle_created' ELSE NEW.last_trigger END,
    NEW.last_actor
  );
  UPDATE tools SET current_state = NEW.state, current_cycle_id = NEW.id WHERE id = NEW.tool_id;
  RETURN NULL;
END
$$;
CREATE TRIGGER cycles_history AFTER INSERT OR UPDATE OF state ON cycles
  FOR EACH ROW EXECUTE FUNCTION cycles_write_history();

-- M8: a task is never deleted; its identity does not change; its cost is set only once, at closing
-- (from queued / in_progress to done / blocked / failed), and a closed task no longer changes; a started task does not
-- go back to the queue; the number of runs only grows (B7).
CREATE FUNCTION tasks_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tasks: deletion refused (task %)', OLD.id;
  END IF;
  IF (NEW.id, NEW.tool_id, NEW.cycle_id, NEW.step, NEW.role, NEW.iteration, NEW.attempt, NEW.branch, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tool_id, OLD.cycle_id, OLD.step, OLD.role, OLD.iteration, OLD.attempt, OLD.branch, OLD.created_at) THEN
    RAISE EXCEPTION 'tasks: the identity of task % is immutable', OLD.id;
  END IF;
  IF OLD.status IN ('done', 'blocked', 'failed') THEN
    RAISE EXCEPTION 'tasks: task % closed (%), nothing changes any more (cost set at closing)', OLD.id, OLD.status;
  END IF;
  IF NEW.status IN ('queued', 'in_progress') AND NEW.cost_usd IS DISTINCT FROM OLD.cost_usd THEN
    RAISE EXCEPTION 'tasks: the cost of task % is set when it closes, not before', OLD.id;
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status = 'queued' THEN
    RAISE EXCEPTION 'tasks: a started task does not go back to the queue (%)', OLD.id;
  END IF;
  IF NEW.executions < OLD.executions THEN
    RAISE EXCEPTION 'tasks: the number of executions of task % does not decrease', OLD.id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tasks_protection BEFORE UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_protect();
CREATE TRIGGER tasks_no_truncate BEFORE TRUNCATE ON tasks FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

-- M8 / D22: the workflow memory is written only with a transition (or a trace) of the cycle, in the same transaction;
-- never deleted.
CREATE FUNCTION memory_with_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cycle_memory: deletion refused (cycle %)', OLD.cycle_id;
  END IF;
  IF NOT transition_in_this_transaction(NEW.cycle_id) THEN
    RAISE EXCEPTION 'cycle_memory: changes only with a transition of cycle % (same transaction)', NEW.cycle_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER memory_transition BEFORE INSERT OR UPDATE OR DELETE ON cycle_memory
  FOR EACH ROW EXECUTE FUNCTION memory_with_transition();
CREATE TRIGGER memory_no_truncate BEFORE TRUNCATE ON cycle_memory FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

-- Down Migration
DROP TRIGGER memory_no_truncate ON cycle_memory;
DROP TRIGGER memory_transition ON cycle_memory;
DROP TRIGGER tasks_no_truncate ON tasks;
DROP TRIGGER tasks_protection ON tasks;
DROP TRIGGER approvals_top_up_transition ON approvals;
DROP FUNCTION memory_with_transition();
DROP FUNCTION tasks_protect();
DROP FUNCTION approvals_top_up_with_transition();
DROP FUNCTION transition_in_this_transaction(bigint, text, text);
DROP TRIGGER history_insertion ON tool_history;
DROP TRIGGER deployments_prod ON deployments;
DROP TRIGGER approvals_top_up ON approvals;
DROP TRIGGER messages_no_truncate ON messages;
DROP TRIGGER pipeline_results_no_truncate ON pipeline_results;
DROP TRIGGER deployments_no_truncate ON deployments;
DROP TRIGGER deviations_no_truncate ON deviations;
DROP TRIGGER approvals_no_truncate ON approvals;
DROP TRIGGER tool_history_no_truncate ON tool_history;
DROP TRIGGER cycles_history ON cycles;
DROP TRIGGER tools_archiving ON tools;
DROP TRIGGER cycles_protection ON cycles;
DROP TRIGGER cycles_creation ON cycles;
DROP TRIGGER cycles_transition ON cycles;
DROP TRIGGER approvals_gate ON approvals;
DROP TRIGGER approvals_append_only ON approvals;
DROP TRIGGER messages_append_only ON messages;
DROP TRIGGER pipeline_results_append_only ON pipeline_results;
DROP TRIGGER deployments_append_only ON deployments;
DROP TRIGGER deviations_append_only ON deviations;
DROP TRIGGER tool_history_append_only ON tool_history;
DROP FUNCTION history_verify_insertion();
DROP FUNCTION deployments_verify_prod();
DROP FUNCTION approvals_apply_top_up();
DROP FUNCTION cycles_write_history();
DROP FUNCTION tools_protect_archiving();
DROP FUNCTION cycles_protect();
DROP FUNCTION cycles_verify_creation();
DROP FUNCTION cycles_verify_transition();
DROP FUNCTION approvals_verify_gate();
DROP FUNCTION refuse_modification();
DROP TABLE events;
DROP TABLE cycle_memory;
DROP TABLE messages;
DROP TABLE deviations;
DROP TABLE pipeline_results;
DROP TABLE deployments;
DROP TABLE approvals;
DROP TABLE tasks;
DROP TABLE tool_history;
ALTER TABLE tools DROP CONSTRAINT tools_current_cycle_fk;
DROP TABLE cycles;
DROP TABLE tools;
DROP TABLE allowed_transitions;
DROP TABLE states;
