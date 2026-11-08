-- Up Migration
-- The hardening escalation gate also has the "scope change" button (a defect of the frozen contract found by a red
-- CI goes back to the contract, like Gate 1): the approval row may carry it there too. Never an existing migration
-- changed (ADR-004): DROP then ADD, under a short lock (small table).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE approvals DROP CONSTRAINT approvals_gate1_scope;
ALTER TABLE approvals ADD CONSTRAINT approvals_scope_change
  CHECK (decision <> 'scope_change' OR gate IN ('gate_1', 'gate_hardening_blocked'));

-- Down Migration
-- Back to the constraint of 0001: refused by PostgreSQL while such a decision exists (fail-closed, nothing is lost).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE approvals DROP CONSTRAINT approvals_scope_change;
ALTER TABLE approvals ADD CONSTRAINT approvals_gate1_scope CHECK (decision <> 'scope_change' OR gate = 'gate_1');
