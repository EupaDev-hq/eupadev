-- Up Migration
-- Maintenance requests (docs/reflexions/2026-10-19-note-exemple-demandes.md §4, §5; ADR-003, ADR-004).
-- The requests (identifiers only) on one side, their free texts and their attachment (personal data) on the other;
-- the status history and the legality of transitions are kept by the database (decision E7).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── Code reference list: never deleted, deactivated ────────────────────────────
CREATE TABLE categories (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label      text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version    bigint NOT NULL DEFAULT 1
);

-- ── Requests: pseudonymised (identifiers, closed lists) ────────────────────────
CREATE TABLE requests (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  category_code text NOT NULL REFERENCES categories (code),
  urgency       text NOT NULL CHECK (urgency IN ('low', 'normal', 'high')),
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'submitted', 'in_progress', 'resolved', 'rejected', 'cancelled')),
  requester_id  uuid NOT NULL REFERENCES actors (id),
  assignee_id   uuid REFERENCES actors (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       bigint NOT NULL DEFAULT 1,
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES actors (id),
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
CREATE INDEX requests_requester ON requests (requester_id, created_at, id);
CREATE INDEX requests_status ON requests (status, created_at, id);
CREATE INDEX requests_category ON requests (category_code);

-- ── Personal data of the request (free texts), purged with it ──────────────────
-- closing_note: reason for rejection or resolution note, never in the history.
CREATE TABLE request_details (
  request_id   uuid PRIMARY KEY REFERENCES requests (id),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description  text NOT NULL CHECK (length(description) <= 4000),
  location     text NOT NULL CHECK (length(location) BETWEEN 1 AND 120),
  closing_note text CHECK (closing_note IS NULL OR length(closing_note) BETWEEN 1 AND 2000)
);

-- Attachment in the database (decisions E4, E5): one per request, 5 MiB, three types checked by signature on entry.
CREATE TABLE request_attachments (
  request_id uuid PRIMARY KEY REFERENCES requests (id),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name !~ '[/\\[:cntrl:]]'),
  media_type text NOT NULL CHECK (media_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  content    bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Business history <entity>_history: append only, no free text, no FK to the request ──
-- (the request may be purged before its history: separate retention periods, docs/DECISIONS.md).
CREATE TABLE request_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id  uuid NOT NULL,
  from_status text CHECK (from_status IN ('draft', 'submitted', 'in_progress', 'resolved', 'rejected', 'cancelled')),
  to_status   text NOT NULL CHECK (to_status IN ('draft', 'submitted', 'in_progress', 'resolved', 'rejected', 'cancelled')),
  actor_id    uuid NOT NULL REFERENCES actors (id),
  actor_type  text NOT NULL CHECK (actor_type IN ('human', 'machine')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_history_request ON request_history (request_id, id);
CREATE INDEX request_history_at ON request_history (at);

-- ── Transitions (§4) ───────────────────────────────────────────────────────────
-- A request is born a draft; a status change outside the list is refused (constraint requests_transition: the
-- handler turns it into 422 INVALID_TRANSITION); resolving or rejecting requires the closing note, written in the
-- same transaction before the status change. Every status reached adds a history row with the actor of the
-- transaction (the current status is the copy of the last row).
CREATE FUNCTION requests_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor       uuid := current_actor();
  actor_kind  text;
  previous    text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'requests: a request is born a draft, not %', NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'requests_transition';
    END IF;
  ELSE
    IF NEW.status = OLD.status THEN
      RETURN NEW;
    END IF;
    previous := OLD.status;
    IF (previous, NEW.status) NOT IN (VALUES ('draft', 'submitted'), ('draft', 'cancelled'), ('submitted', 'cancelled'),
        ('submitted', 'in_progress'), ('submitted', 'rejected'), ('in_progress', 'resolved'), ('in_progress', 'rejected')) THEN
      RAISE EXCEPTION 'requests: transition % -> % refused', previous, NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'requests_transition';
    END IF;
    IF NEW.status IN ('resolved', 'rejected')
       AND NOT EXISTS (SELECT FROM request_details d WHERE d.request_id = NEW.id AND d.closing_note IS NOT NULL) THEN
      RAISE EXCEPTION 'requests: % requires a closing note', NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'requests_transition';
    END IF;
  END IF;
  SELECT a.type INTO actor_kind FROM actors a WHERE a.id = actor;
  IF actor_kind IS NULL THEN
    RAISE EXCEPTION 'requests: transition without a known actor (write outside ctx.db.tx())' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO request_history (request_id, from_status, to_status, actor_id, actor_type) VALUES (NEW.id, previous, NEW.status, actor, actor_kind);
  RETURN NEW;
END
$$;

-- The web process has INSERT on request_history (triggers write with its privileges): a direct insert, outside the
-- trigger of requests, is refused (trigger depth 1 = the insert comes from an SQL statement).
CREATE FUNCTION request_history_by_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'request_history: written only by the trigger of requests' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- ── Triggers ───────────────────────────────────────────────────────────────────
CREATE TRIGGER categories_audit AFTER INSERT OR UPDATE OR DELETE ON categories FOR EACH ROW EXECUTE FUNCTION audit_row('code');
CREATE TRIGGER categories_version BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at_version();
CREATE TRIGGER requests_audit AFTER INSERT OR UPDATE OR DELETE ON requests FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER requests_transition BEFORE INSERT OR UPDATE OF status ON requests FOR EACH ROW EXECUTE FUNCTION requests_transition();
CREATE TRIGGER requests_version BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION set_updated_at_version();
CREATE TRIGGER request_details_audit AFTER INSERT OR UPDATE OR DELETE ON request_details FOR EACH ROW EXECUTE FUNCTION audit_row('request_id');
CREATE TRIGGER request_attachments_audit AFTER INSERT OR UPDATE OR DELETE ON request_attachments FOR EACH ROW EXECUTE FUNCTION audit_row('request_id');
CREATE TRIGGER request_history_insertion BEFORE INSERT ON request_history FOR EACH ROW EXECUTE FUNCTION request_history_by_trigger();
CREATE TRIGGER request_history_append_only BEFORE UPDATE ON request_history FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER request_history_no_truncate BEFORE TRUNCATE ON request_history FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

-- ── Privileges (on top of the core's default privileges: SELECT, INSERT, UPDATE to the web; SELECT, DELETE to the purge) ──
-- Removing an attachment erases it (personal data with no planned restore); the history is never modified.
GRANT DELETE ON request_attachments TO core_app;
REVOKE UPDATE ON request_history FROM core_app;
