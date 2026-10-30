-- Up Migration
-- A-R1 (ADR-021): a single `builder` agent writes the code, instead of `backend` and `frontend`; `integration` is no
-- longer a role. The three CHECK constraints that name the roles accept `builder`; the old values STAY accepted:
-- the historical rows stay readable, none is rewritten (the trigger tasks_protect forbids changing the role
-- of a task). Never an existing migration changed (ADR-004): DROP then ADD, under a short lock (small tables).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE tasks DROP CONSTRAINT tasks_role_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_role_check
  CHECK (role IN ('overlap', 'scoping', 'contract', 'backend', 'frontend', 'tests', 'builder', 'integration', 'security-reviewer', 'quality-reviewer'));

ALTER TABLE tasks DROP CONSTRAINT tasks_tree_hash_code_role;
ALTER TABLE tasks ADD CONSTRAINT tasks_tree_hash_code_role
  CHECK (tree_hash IS NULL OR role IN ('backend', 'frontend', 'tests', 'builder'));

ALTER TABLE deviations DROP CONSTRAINT deviations_source_check;
ALTER TABLE deviations ADD CONSTRAINT deviations_source_check
  CHECK (source IN ('overlap', 'scoping', 'contract', 'backend', 'frontend', 'tests', 'builder', 'integration', 'security-reviewer', 'quality-reviewer', 'orchestrator'));

-- Down Migration
-- Back to the constraints of 0001: refused by PostgreSQL while a `builder` row exists (fail-closed, nothing is lost).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE deviations DROP CONSTRAINT deviations_source_check;
ALTER TABLE deviations ADD CONSTRAINT deviations_source_check
  CHECK (source IN ('overlap', 'scoping', 'contract', 'backend', 'frontend', 'tests', 'integration', 'security-reviewer', 'quality-reviewer', 'orchestrator'));

ALTER TABLE tasks DROP CONSTRAINT tasks_tree_hash_code_role;
ALTER TABLE tasks ADD CONSTRAINT tasks_tree_hash_code_role
  CHECK (tree_hash IS NULL OR role IN ('backend', 'frontend', 'tests'));

ALTER TABLE tasks DROP CONSTRAINT tasks_role_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_role_check
  CHECK (role IN ('overlap', 'scoping', 'contract', 'backend', 'frontend', 'tests', 'integration', 'security-reviewer', 'quality-reviewer'));
