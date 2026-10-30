-- Up Migration
-- Step 8 (purge, bin/purge.js): a deletion made by the purge role is not audited. The purge only has SELECT,
-- DELETE on audit_log (ADR-003: it never modifies it, inserts included); the log stays identical byte for byte except
-- for outdated rows (purge test of ADR-003); its trace is the output of bin/purge.js (number of rows per statement).
-- Every other write is audited as before.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
  IF TG_OP = 'DELETE' AND pg_has_role(current_user, 'core_purge', 'MEMBER') THEN
    RETURN NULL;
  END IF;
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
