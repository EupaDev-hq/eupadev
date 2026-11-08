-- Up Migration
-- ADR-027: a read-only `diagnosis` task runs before the hardening-blocked gate opens. The CHECK constraint on the
-- task roles accepts it; the old values STAY accepted (historical rows readable, none rewritten). Never an
-- existing migration changed (ADR-004): DROP then ADD, under a short lock (small table). `deviations.source` is
-- untouched: a diagnosis writes no deviation.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE tasks DROP CONSTRAINT tasks_role_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_role_check
  CHECK (role IN ('overlap', 'scoping', 'contract', 'backend', 'frontend', 'tests', 'builder', 'integration', 'security-reviewer', 'quality-reviewer', 'diagnosis'));

-- Down Migration
-- Back to the constraint of 0011: refused by PostgreSQL while a `diagnosis` row exists (fail-closed, nothing is lost).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE tasks DROP CONSTRAINT tasks_role_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_role_check
  CHECK (role IN ('overlap', 'scoping', 'contract', 'backend', 'frontend', 'tests', 'builder', 'integration', 'security-reviewer', 'quality-reviewer'));
