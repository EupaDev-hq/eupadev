-- PostgreSQL accounts of the orchestrator (ROADMAP §8, step 6). Idempotent: safe to run again, by a
-- superuser, on the orchestrator's database:
--   psql -v ON_ERROR_STOP=1 -v owner_password=… -v engine_password=… -d <db> -f sql/roles.sql
-- Passwords in psql variables, never in this file. The engine's grants on the tables are in
-- migrations/0003_grants.sql (versioned with the schema); here, only the accounts and the ownership of the database.
--   orch_owner: applies the migrations (owner of the database, hence of the public schema, owned by
--                pg_database_owner since PostgreSQL 15); neither superuser nor creation of roles/databases.
--   orch_engine: the engine day to day; owner of nothing, no attribute but login.
-- The superuser created by the image stays the rescue account, never used by an application.

SELECT 'CREATE ROLE orch_owner' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orch_owner') \gexec
SELECT 'CREATE ROLE orch_engine' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orch_engine') \gexec

-- Attributes set at each run (an attribute added by hand is removed; password rotation).
ALTER ROLE orch_owner WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'owner_password';
ALTER ROLE orch_engine WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'engine_password';

-- DBNAME: psql variable, the current database.
ALTER DATABASE :"DBNAME" OWNER TO orch_owner;
