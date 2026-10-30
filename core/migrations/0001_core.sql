-- Up Migration
-- Tables and functions of the core (§2.5, §2.6 of the "common core" research; ADR-003, ADR-004, ADR-017), app schema,
-- expansion only: no later version of the core drops or renames what a tool may reference.
-- Applied by <tool>_owner (bin/migrate.js, table core_migrations); the grants target the group roles core_app and
-- core_purge of sql/roles.sql. The triggers are not SECURITY DEFINER: they write with the rights of the role that
-- writes.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

GRANT USAGE ON SCHEMA app TO core_app, core_purge;

-- ── Identity (ADR-017) ─────────────────────────────────────────────────────────
-- A person = an internal identifier, never their mail; their OIDC key (issuer, subject) in an append-only link
-- table. token_version: incremented on every privilege change, compared on every request (ASVS 7.4.2).
CREATE TABLE actors (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  type            text NOT NULL CHECK (type IN ('human', 'machine')),
  mail            text CHECK (mail IS NULL OR mail ~ '^[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$'),
  display_name    text NOT NULL CHECK (btrim(display_name) <> '' AND display_name !~ '[[:cntrl:]]'),
  directory_id    text CHECK (directory_id IS NULL OR btrim(directory_id) <> ''),
  token_version   bigint NOT NULL DEFAULT 1 CHECK (token_version >= 1),
  last_sign_in_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
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

-- ── Sessions (§2.3): `id.secret` token, only SHA-256(secret) stored ────────────
CREATE TABLE sessions (
  id                  text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{16,64}$'),
  secret_hash         bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  actor_id            uuid NOT NULL REFERENCES actors (id),
  roles               text[] NOT NULL,
  sid                 text CHECK (sid IS NULL OR btrim(sid) <> ''),
  id_token            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_actor ON sessions (actor_id);
CREATE INDEX sessions_sid ON sessions (sid) WHERE sid IS NOT NULL;
CREATE INDEX sessions_expiration ON sessions (absolute_expires_at);

-- ── Audit (§2.6, ADR-003): names of the changed columns, never a value nor jsonb ──
CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid NOT NULL REFERENCES actors (id),
  actor_type      text NOT NULL CHECK (actor_type IN ('human', 'machine')),
  request_id      text NOT NULL CHECK (btrim(request_id) <> ''),
  txid            bigint NOT NULL,
  table_name      text NOT NULL,
  row_id          uuid NOT NULL,
  op              text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_columns text[] NOT NULL
);
CREATE INDEX audit_log_row ON audit_log (table_name, row_id, id);
CREATE INDEX audit_log_at ON audit_log (at);

-- ── Rate limiting (§2.7): one INSERT … ON CONFLICT statement per request ──
CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        bigint NOT NULL CHECK (count > 0),
  PRIMARY KEY (key, window_start)
);

-- ── Functions ──────────────────────────────────────────────────────────────────
CREATE FUNCTION refuse_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;

-- Identity of the request, set by ctx.db.tx() through set_config(…, true). After the transaction, the connection
-- given back to the pool carries an empty string, not NULL: NULLIF fails closed (a cast of '' to uuid would fail anyway).
CREATE FUNCTION current_actor() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;

-- Generic audit trigger: AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW on every business table keyed by `id uuid`.
CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor      uuid := current_actor();
  request    text := NULLIF(current_setting('app.request_id', true), '');
  actor_kind text;
  row_value  uuid;
  columns    text[] := '{}';
BEGIN
  IF actor IS NULL OR request IS NULL THEN
    RAISE EXCEPTION 'audit: app.actor_id and app.request_id required (write on % outside ctx.db.tx())', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT a.type INTO actor_kind FROM actors a WHERE a.id = actor;
  IF actor_kind IS NULL THEN
    RAISE EXCEPTION 'audit: unknown actor %', actor USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    row_value := (to_jsonb(OLD) ->> 'id')::uuid;
  ELSE
    row_value := (to_jsonb(NEW) ->> 'id')::uuid;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}') INTO columns
    FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
    WHERE n.value IS DISTINCT FROM o.value;
  END IF;
  INSERT INTO audit_log (actor_id, actor_type, request_id, txid, table_name, row_id, op, changed_columns)
  VALUES (actor, actor_kind, request, pg_current_xact_id()::text::bigint, TG_TABLE_NAME, row_value, TG_OP, columns);
  RETURN NULL;
END
$$;

-- audit_log: never modified; deleted only by the purge role, row by row, beyond the retention period of the audit
-- trail set at Gate 1 (ALTER DATABASE … SET core.audit_retention = '1 year'; ADR-003: 6 to 12 months proposed), without a default.
CREATE FUNCTION audit_log_protect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  retention interval := NULLIF(current_setting('core.audit_retention', true), '')::interval;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    RAISE EXCEPTION 'audit_log: % refused', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT pg_has_role(current_user, 'core_purge', 'MEMBER') THEN
    RAISE EXCEPTION 'audit_log: deletion reserved for the purge role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF retention IS NULL THEN
    RAISE EXCEPTION 'audit_log: setting core.audit_retention missing (period set at Gate 1, without a default)';
  END IF;
  IF OLD.at >= now() - retention THEN
    RAISE EXCEPTION 'audit_log: row % still within the retention period', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END
$$;

-- An actor is never deleted (the audit references it); id, type and created_at are immutable.
CREATE FUNCTION actors_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'actors: deletion refused (actor %)', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.type, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.type, OLD.created_at) THEN
    RAISE EXCEPTION 'actors: id, type and created_at of actor % are immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- updated_at and version (ADR-003) on the business tables: BEFORE UPDATE FOR EACH ROW.
CREATE FUNCTION set_updated_at_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;

-- ── Triggers of the core ───────────────────────────────────────────────────────
CREATE TRIGGER actors_protection BEFORE UPDATE OR DELETE ON actors FOR EACH ROW EXECUTE FUNCTION actors_protect();
CREATE TRIGGER actors_no_truncate BEFORE TRUNCATE ON actors FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER actor_identities_append_only BEFORE UPDATE OR DELETE ON actor_identities FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER actor_identities_no_truncate BEFORE TRUNCATE ON actor_identities FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER audit_log_protection BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_protect();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

-- ── Rights ─────────────────────────────────────────────────────────────────────
-- The web process: read and insert on identity and audit, update of the only live attributes of an actor, all the
-- DML on its sessions and counters. The purge: read and delete only.
GRANT SELECT, INSERT ON actors, actor_identities, audit_log TO core_app;
GRANT UPDATE (mail, display_name, directory_id, last_sign_in_at, token_version) ON actors TO core_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, rate_limits TO core_app;
GRANT SELECT, DELETE ON audit_log, sessions, rate_limits TO core_purge;
-- Future tables of the tool (created by the owner in app): DML without DELETE for the web process (soft delete,
-- ADR-003), DELETE for the purge; an append-only table adds its refuse_modification trigger.
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE ON TABLES TO core_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, DELETE ON TABLES TO core_purge;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO core_app;
