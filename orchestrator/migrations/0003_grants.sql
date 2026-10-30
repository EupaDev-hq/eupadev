-- Up Migration
-- Grants of the engine's account (step 6). Prerequisite: the accounts of sql/roles.sql; migration applied by
-- orch_owner, owner of the tables. The engine owns nothing: ALTER/DROP (disabling or
-- dropping a trigger), TRUNCATE, session_replication_role, CREATE in public or CREATE SCHEMA are refused to it
-- by PostgreSQL itself. The triggers are not SECURITY DEFINER: they write with the engine's rights
-- (history: INSERT; tools and cycles: UPDATE, guarded by their protection triggers).
-- Every new modifiable table gets its explicit GRANT UPDATE in its migration; otherwise it is only
-- read and appended to (default privileges below). No DELETE: the code does none.

-- Append-only tables: read and append.
GRANT SELECT, INSERT ON tool_history, approvals, deviations, deployments, pipeline_results, messages TO orch_engine;
-- State machine: read-only (filled by the generated migration).
GRANT SELECT ON states, allowed_transitions TO orch_engine;
-- Live tables: modifiable, each one guarded by its triggers.
GRANT SELECT, INSERT, UPDATE ON tools, cycles, tasks, cycle_memory, events TO orch_engine;
-- pgmigrations: nothing.

-- Future tables of orch_owner in public: readable and appendable, never modifiable by default.
ALTER DEFAULT PRIVILEGES FOR ROLE orch_owner IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO orch_engine;

-- Down Migration
ALTER DEFAULT PRIVILEGES FOR ROLE orch_owner IN SCHEMA public REVOKE SELECT, INSERT ON TABLES FROM orch_engine;
REVOKE ALL ON tools, cycles, tasks, cycle_memory, events FROM orch_engine;
REVOKE ALL ON states, allowed_transitions FROM orch_engine;
REVOKE ALL ON tool_history, approvals, deviations, deployments, pipeline_results, messages FROM orch_engine;
