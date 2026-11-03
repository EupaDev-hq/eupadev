-- Up Migration
-- Actor merge (completes ADR-017): a person whose `sub`
-- changed and who signed in BEFORE being attached became a second actor B; `actor_identities` (primary
-- key on (issuer, subject), append-only) can no longer say that B = A. The merge is an APPEND-ONLY row
-- "B is absorbed by A", decided by an admin (never by B or A themselves), with its reason. The history is not
-- rewritten: the audit rows keep the id written at the time of the facts; every read where the identity matters
-- (requester of the tool, four eyes, principal) goes through `canonical_actor(id)`, which follows the merges to the end.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE actor_merges (
  -- An actor is absorbed only once (primary key): the chain B → A → C is read through `canonical_actor`, never rewritten.
  absorbed_actor uuid PRIMARY KEY REFERENCES actors (id),
  target_actor   uuid NOT NULL REFERENCES actors (id),
  since          timestamptz NOT NULL DEFAULT now(),
  reason         text NOT NULL CHECK (btrim(reason) <> ''),
  -- The admin who decided (actors.id, read in their token by the API); never the absorbed actor nor the target.
  decided_by     uuid NOT NULL REFERENCES actors (id)
);
CREATE INDEX actor_merges_target ON actor_merges (target_actor);
CREATE TRIGGER actor_merges_append_only BEFORE UPDATE OR DELETE ON actor_merges
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER actor_merges_no_truncate BEFORE TRUNCATE ON actor_merges
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

-- Canonical actor: follows the merges (B → A → C gives C); an actor never absorbed is its own canonical actor.
-- Transitive by construction: merging A into C after B → A does not require rewriting B → A (append-only).
-- The depth bound is only a belt: the trigger below refuses cycles.
CREATE FUNCTION canonical_actor(id uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  WITH RECURSIVE merge_chain (actor, depth) AS (
    SELECT id, 0
    UNION ALL
    SELECT f.target_actor, c.depth + 1 FROM merge_chain c JOIN actor_merges f ON f.absorbed_actor = c.actor WHERE c.depth < 100
  )
  SELECT actor FROM merge_chain ORDER BY depth DESC LIMIT 1
$$;

CREATE FUNCTION actor_merges_verify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.absorbed_actor = NEW.target_actor THEN
    RAISE EXCEPTION 'merge refused: self-merge of actor %', NEW.absorbed_actor;
  END IF;
  -- Cycle: the target (or what it has already become) must not lead back to the absorbed actor.
  IF canonical_actor(NEW.target_actor) = NEW.absorbed_actor THEN
    RAISE EXCEPTION 'merge refused: cycle, % already is (or becomes) the canonical actor of %', NEW.absorbed_actor, NEW.target_actor;
  END IF;
  -- Only people are merged: the machine actors have fixed ids in the code.
  IF (SELECT type FROM actors WHERE id = NEW.absorbed_actor) <> 'human' OR (SELECT type FROM actors WHERE id = NEW.target_actor) <> 'human' THEN
    RAISE EXCEPTION 'merge refused: only two human actors are merged (% → %)', NEW.absorbed_actor, NEW.target_actor;
  END IF;
  -- Four eyes of the merge: the admin does not attach their own identity (neither as absorbed nor as target).
  IF NEW.decided_by = NEW.absorbed_actor OR canonical_actor(NEW.decided_by) = canonical_actor(NEW.target_actor) THEN
    RAISE EXCEPTION 'merge refused: admin % does not merge their own identity', NEW.decided_by;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER actor_merges_verification BEFORE INSERT ON actor_merges
  FOR EACH ROW EXECUTE FUNCTION actor_merges_verify();

-- Four eyes at Gate 2 (0008), on the CANONICAL actors: the approver and the requester of the tool are not the
-- same person, even if one of the two ids has been absorbed since the row was written.
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
     AND canonical_actor(NEW.actor_id) IS NOT DISTINCT FROM canonical_actor((SELECT requester_id FROM tools WHERE id = NEW.tool_id)) THEN
    RAISE EXCEPTION 'Gate 2 approval refused: four eyes, the requester of tool % does not approve their own delivery', NEW.tool_id;
  END IF;
  RETURN NEW;
END
$$;

-- Engine's grants: read and append (default privileges of 0003), never UPDATE nor DELETE. It is the admin API
-- (`POST /actors/merges`, admin hat read in the token) that writes the row: `decided_by` is thus a verified
-- identity, never free text, and nobody touches the production database by hand.

-- Down Migration
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
DROP TRIGGER actor_merges_verification ON actor_merges;
DROP FUNCTION actor_merges_verify();
DROP FUNCTION canonical_actor(uuid);
DROP TRIGGER actor_merges_no_truncate ON actor_merges;
DROP TRIGGER actor_merges_append_only ON actor_merges;
DROP TABLE actor_merges;
