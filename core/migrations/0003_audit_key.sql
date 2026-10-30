-- Up Migration
-- Step 8 ("requests" tool): audit_row() also audits the tables whose key is not `id uuid` (reference table keyed by
-- a `text` code, table with a shared key `request_id`, ADR-003). The trigger gets the name of its key column as an
-- argument (`EXECUTE FUNCTION audit_row('code')`, `id` without an argument, as before): a uuid key goes into row_id,
-- any other into row_key, never both. Expansion only (ADR-004, ADR-019): the existing triggers do not change.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE audit_log ADD COLUMN row_key text CHECK (row_key IS NULL OR btrim(row_key) <> '');
-- No code of the core reads row_id (the log only serves operations); audit_log_row guarantees one of the two keys.
-- squawk-ignore ban-drop-not-null
ALTER TABLE audit_log ALTER COLUMN row_id DROP NOT NULL;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_row CHECK ((row_id IS NULL) <> (row_key IS NULL)) NOT VALID;
ALTER TABLE audit_log VALIDATE CONSTRAINT audit_log_row;
CREATE INDEX audit_log_row_key ON audit_log (table_name, row_key, id) WHERE row_key IS NOT NULL;

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor      uuid := current_actor();
  request    text := NULLIF(current_setting('app.request_id', true), '');
  key_column text := coalesce(TG_ARGV[0], 'id');
  key_type   regtype;
  key_value  text;
  actor_kind text;
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
  SELECT a.atttypid::regtype INTO key_type FROM pg_attribute a WHERE a.attrelid = TG_RELID AND a.attname = key_column AND NOT a.attisdropped;
  IF key_type IS NULL THEN
    RAISE EXCEPTION 'audit: key column % missing from %', key_column, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    key_value := to_jsonb(OLD) ->> key_column;
  ELSE
    key_value := to_jsonb(NEW) ->> key_column;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}') INTO columns
    FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
    WHERE n.value IS DISTINCT FROM o.value;
  END IF;
  INSERT INTO audit_log (actor_id, actor_type, request_id, txid, table_name, row_id, row_key, op, changed_columns)
  VALUES (actor, actor_kind, request, pg_current_xact_id()::text::bigint, TG_TABLE_NAME,
          CASE WHEN key_type = 'uuid'::regtype THEN key_value::uuid END,
          CASE WHEN key_type <> 'uuid'::regtype THEN key_value END, TG_OP, columns);
  RETURN NULL;
END
$$;
