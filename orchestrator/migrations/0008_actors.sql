-- Up Migration
-- I0, identity of people (docs/reflexions/2026-10-15-note-identite-I0.md, ADR-017): a person is designated by
-- an internal id (`actors.id`), never by their mail nor by free text; their OIDC key `(issuer, subject)` lives
-- in an APPEND-ONLY link table (D1: a `sub` that changes is attached by a traced INSERT, never an UPDATE).
-- The audit tables get `actor_id`; their text column (`actor`, `author`) becomes a snapshot of the name at the
-- time of the facts, filled by a trigger. Earlier rows stay as they are (CHECK … NOT VALID: any new write
-- requires the id, the history is not rewritten). Small tables: scan under a bounded lock (ADR-004).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE actors (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  type         text NOT NULL CHECK (type IN ('human', 'machine')),
  -- Contact attributes, refreshed at each authenticated request; never a key.
  mail         text CHECK (mail IS NULL OR mail ~ '^[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$'),
  display_name text NOT NULL CHECK (btrim(display_name) <> '' AND display_name !~ '[[:cntrl:]]'),
  -- Hint for a manual attachment (LDAP_ID attribute set by Keycloak), never a key (D1).
  directory_id text CHECK (directory_id IS NULL OR btrim(directory_id) <> ''),
  last_sign_in timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE actor_identities (
  issuer   text NOT NULL CHECK (btrim(issuer) <> ''),
  subject  text NOT NULL CHECK (btrim(subject) <> ''),
  actor_id uuid NOT NULL REFERENCES actors (id),
  since    timestamptz NOT NULL DEFAULT now(),
  reason   text NOT NULL CHECK (btrim(reason) <> ''),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX actor_identities_actor ON actor_identities (actor_id);
CREATE TRIGGER actor_identities_append_only BEFORE UPDATE OR DELETE ON actor_identities
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER actor_identities_no_truncate BEFORE TRUNCATE ON actor_identities
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

-- An actor is never deleted (the audit refers to it for 3 years); its id and its type do not change.
CREATE FUNCTION actors_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'actors: deletion refused (actor %)', OLD.id;
  END IF;
  IF (NEW.id, NEW.type, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.type, OLD.created_at) THEN
    RAISE EXCEPTION 'actors: id, type and created_at of actor % are immutable', OLD.id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER actors_protection BEFORE UPDATE OR DELETE ON actors
  FOR EACH ROW EXECUTE FUNCTION actors_protect();
CREATE TRIGGER actors_no_truncate BEFORE TRUNCATE ON actors FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

-- Machine actors, fixed ids (src/db.ts: ORCHESTRATOR_ACTOR, FORGE_ACTOR).
INSERT INTO actors (id, type, display_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'machine', 'orchestrator'),
  ('00000000-0000-0000-0000-000000000002', 'machine', 'forge');

-- Identity columns. NOT VALID: the earlier rows stay readable (NULL), every new or changed row must
-- carry the id.
ALTER TABLE tools
  ADD COLUMN requester_id uuid REFERENCES actors (id),
  ADD CONSTRAINT tools_requester_id_present CHECK (requester_id IS NOT NULL) NOT VALID;
ALTER TABLE cycles
  ADD COLUMN last_actor_id uuid REFERENCES actors (id),
  ADD CONSTRAINT cycles_last_actor_id_present CHECK (last_actor_id IS NOT NULL) NOT VALID;
ALTER TABLE tool_history
  ADD COLUMN actor_id uuid REFERENCES actors (id),
  ADD CONSTRAINT tool_history_actor_id_present CHECK (actor_id IS NOT NULL) NOT VALID;
ALTER TABLE approvals
  ADD COLUMN actor_id uuid REFERENCES actors (id),
  -- Hat under which the decision was made (roles of the eupadev-api client).
  ADD COLUMN role text CHECK (role IN ('requester', 'admin')),
  -- Four eyes: true only when FOUR_EYES_EXEMPTION_SUBJECT allowed the self-approval (traced, never implicit).
  ADD COLUMN four_eyes_exemption boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT approvals_actor_id_present CHECK (actor_id IS NOT NULL AND role IS NOT NULL) NOT VALID;
ALTER TABLE messages
  ADD COLUMN actor_id uuid REFERENCES actors (id),
  ADD CONSTRAINT messages_actor_id_present CHECK (actor_id IS NOT NULL) NOT VALID;
CREATE INDEX tool_history_actor ON tool_history (actor_id);
CREATE INDEX approvals_actor ON approvals (actor_id);

-- The text of the audit tables = the actor's display name at the time of the facts, set here: the code writes only the id.
CREATE FUNCTION fill_in_actor_name() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  name text;
BEGIN
  IF NEW.actor_id IS NULL THEN
    RAISE EXCEPTION '%: actor_id required (identity of people, migration 0008)', TG_TABLE_NAME;
  END IF;
  SELECT display_name INTO name FROM actors WHERE id = NEW.actor_id;
  IF name IS NULL THEN
    RAISE EXCEPTION '%: unknown actor %', TG_TABLE_NAME, NEW.actor_id;
  END IF;
  IF TG_TABLE_NAME = 'messages' THEN
    NEW.author := name;
  ELSE
    NEW.actor := name;
  END IF;
  RETURN NEW;
END
$$;
-- Name alphabetically before the other BEFORE INSERT triggers of these tables (PostgreSQL's firing order): it does not
-- matter here, none of them reads the text.
CREATE TRIGGER tool_history_actor_name BEFORE INSERT ON tool_history FOR EACH ROW EXECUTE FUNCTION fill_in_actor_name();
CREATE TRIGGER approvals_actor_name BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION fill_in_actor_name();
CREATE TRIGGER messages_actor_name BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION fill_in_actor_name();

-- Cycles trigger (0001) rewritten: the history gets the id; the name comes from the trigger above.
CREATE OR REPLACE FUNCTION cycles_write_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = NEW.state THEN
    RETURN NULL;
  END IF;
  INSERT INTO tool_history (tool_id, cycle_id, previous_state, state, trigger, actor_id)
  VALUES (
    NEW.tool_id, NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state,
    CASE WHEN TG_OP = 'INSERT' THEN 'cycle_created' ELSE NEW.last_trigger END,
    NEW.last_actor_id
  );
  UPDATE tools SET current_state = NEW.state, current_cycle_id = NEW.id WHERE id = NEW.tool_id;
  RETURN NULL;
END
$$;

-- Protection of the cycles (0001): last_actor_id changes only with a transition.
CREATE OR REPLACE FUNCTION cycles_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state AND NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
    RAISE EXCEPTION 'cycles.finished_at is set by the machine (arrival in an end), never by hand (cycle %)', NEW.id;
  END IF;
  IF NEW.type IS DISTINCT FROM OLD.type OR NEW.tool_id IS DISTINCT FROM OLD.tool_id THEN
    RAISE EXCEPTION 'cycles.type and cycles.tool_id are immutable (cycle %)', NEW.id;
  END IF;
  IF NEW.state IS NOT DISTINCT FROM OLD.state AND (NEW.last_trigger IS DISTINCT FROM OLD.last_trigger OR NEW.last_actor_id IS DISTINCT FROM OLD.last_actor_id) THEN
    RAISE EXCEPTION 'cycles.last_trigger and last_actor_id only change with a transition (cycle %)', NEW.id;
  END IF;
  IF (NEW.scoping_budget_usd IS DISTINCT FROM OLD.scoping_budget_usd OR NEW.hardening_budget_usd IS DISTINCT FROM OLD.hardening_budget_usd) AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'budget of cycle % changes only through an approved top-up (approvals)', NEW.id;
  END IF;
  RETURN NEW;
END
$$;

-- Approvals (0001), completed: four eyes at Gate 2 — the approver is not the requester of the tool, except for an
-- explicit exemption (flag set by the engine when FOUR_EYES_EXEMPTION_SUBJECT allows it, so traced).
CREATE OR REPLACE FUNCTION approvals_verify_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM states WHERE id = NEW.gate) IS DISTINCT FROM 'gate' THEN
    RAISE EXCEPTION 'approval on a state that is not a gate: %', NEW.gate;
  END IF;
  IF (SELECT state FROM cycles WHERE id = NEW.cycle_id) IS DISTINCT FROM NEW.gate THEN
    RAISE EXCEPTION 'approval refused: cycle % is not at gate %', NEW.cycle_id, NEW.gate;
  END IF;
  IF NEW.gate = 'gate_2' AND NEW.digest ~ '^sha256:[0-9a-f]{64}$' AND NEW.digest IS DISTINCT FROM (
    SELECT CASE WHEN d.health = 'ok' THEN d.digest END FROM deployments d
    WHERE d.cycle_id = NEW.cycle_id AND d.environment = 'preview' ORDER BY d.id DESC LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Gate 2 approval refused: % is not the candidate digest of cycle %', NEW.digest, NEW.cycle_id;
  END IF;
  IF NEW.gate = 'gate_2' AND NEW.decision = 'approved' AND NOT NEW.four_eyes_exemption
     AND NEW.actor_id IS NOT DISTINCT FROM (SELECT requester_id FROM tools WHERE id = NEW.tool_id) THEN
    RAISE EXCEPTION 'Gate 2 approval refused: four eyes, the requester of tool % does not approve their own delivery', NEW.tool_id;
  END IF;
  RETURN NEW;
END
$$;

-- The text columns of the live tables go (the id replaces them); those of the audit tables stay
-- (snapshot of the name).
ALTER TABLE cycles DROP COLUMN last_actor;
ALTER TABLE tools DROP COLUMN requester;

-- Engine's grants: read and append (default privileges of 0003); update of the contact attributes only.
GRANT UPDATE (mail, display_name, directory_id, last_sign_in) ON actors TO orch_engine;

-- Down Migration
REVOKE UPDATE (mail, display_name, directory_id, last_sign_in) ON actors FROM orch_engine;
ALTER TABLE tools ADD COLUMN requester text;
ALTER TABLE cycles ADD COLUMN last_actor text;
-- Copy of the name (or of the requester's mail) outside the protection triggers; 'unknown' for a row from before 0008.
ALTER TABLE tools DISABLE TRIGGER USER;
ALTER TABLE cycles DISABLE TRIGGER USER;
UPDATE tools o SET requester = coalesce((SELECT coalesce(a.mail, a.display_name) FROM actors a WHERE a.id = o.requester_id), 'unknown');
UPDATE cycles c SET last_actor = coalesce((SELECT a.display_name FROM actors a WHERE a.id = c.last_actor_id), 'unknown');
ALTER TABLE cycles ENABLE TRIGGER USER;
ALTER TABLE tools ENABLE TRIGGER USER;
ALTER TABLE tools ALTER COLUMN requester SET NOT NULL, ADD CONSTRAINT tools_requester_check CHECK (btrim(requester) <> '');
ALTER TABLE cycles ALTER COLUMN last_actor SET NOT NULL, ADD CONSTRAINT cycles_last_actor_check CHECK (btrim(last_actor) <> '');
CREATE OR REPLACE FUNCTION approvals_verify_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM states WHERE id = NEW.gate) IS DISTINCT FROM 'gate' THEN
    RAISE EXCEPTION 'approval on a state that is not a gate: %', NEW.gate;
  END IF;
  IF (SELECT state FROM cycles WHERE id = NEW.cycle_id) IS DISTINCT FROM NEW.gate THEN
    RAISE EXCEPTION 'approval refused: cycle % is not at gate %', NEW.cycle_id, NEW.gate;
  END IF;
  IF NEW.gate = 'gate_2' AND NEW.digest ~ '^sha256:[0-9a-f]{64}$' AND NEW.digest IS DISTINCT FROM (
    SELECT CASE WHEN d.health = 'ok' THEN d.digest END FROM deployments d
    WHERE d.cycle_id = NEW.cycle_id AND d.environment = 'preview' ORDER BY d.id DESC LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Gate 2 approval refused: % is not the candidate digest of cycle %', NEW.digest, NEW.cycle_id;
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE FUNCTION cycles_protect() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION cycles_write_history() RETURNS trigger LANGUAGE plpgsql AS $$
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
DROP TRIGGER messages_actor_name ON messages;
DROP TRIGGER approvals_actor_name ON approvals;
DROP TRIGGER tool_history_actor_name ON tool_history;
DROP FUNCTION fill_in_actor_name();
DROP INDEX approvals_actor;
DROP INDEX tool_history_actor;
ALTER TABLE messages DROP CONSTRAINT messages_actor_id_present, DROP COLUMN actor_id;
ALTER TABLE approvals DROP CONSTRAINT approvals_actor_id_present, DROP COLUMN four_eyes_exemption, DROP COLUMN role, DROP COLUMN actor_id;
ALTER TABLE tool_history DROP CONSTRAINT tool_history_actor_id_present, DROP COLUMN actor_id;
ALTER TABLE cycles DROP CONSTRAINT cycles_last_actor_id_present, DROP COLUMN last_actor_id;
ALTER TABLE tools DROP CONSTRAINT tools_requester_id_present, DROP COLUMN requester_id;
DROP TRIGGER actors_no_truncate ON actors;
DROP TRIGGER actors_protection ON actors;
DROP FUNCTION actors_protect();
DROP TRIGGER actor_identities_no_truncate ON actor_identities;
DROP TRIGGER actor_identities_append_only ON actor_identities;
DROP TABLE actor_identities;
DROP TABLE actors;
