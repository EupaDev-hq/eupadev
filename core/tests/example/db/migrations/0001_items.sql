-- Example migration of a tool (ADR-003, ADR-004): business table audited by the core.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE items (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  version    bigint NOT NULL DEFAULT 1
);
CREATE TRIGGER items_audit AFTER INSERT OR UPDATE OR DELETE ON items FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER items_version BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION set_updated_at_version();
