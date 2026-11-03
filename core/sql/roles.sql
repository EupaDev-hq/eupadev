-- PostgreSQL roles of a tool, run by the platform (deployer or Ansible) with a
-- superuser, on the tool's database, idempotent:
--   psql -v ON_ERROR_STOP=1 -v tool=requests -v owner_password=… -v app_password=… -v purge_password=… -d requests -f sql/roles.sql
-- Two group roles per server, without login: core_app and core_purge; the GRANTs of migrations/0001_core.sql
-- target them, so the core's migration is a literal SQL identical for every tool.
-- Three login roles per tool: <tool>_owner (owner of the database and of the app schema: migrations only),
-- <tool>_app (member of core_app: the web process), <tool>_purge (member of core_purge: DELETE of outdated rows).
-- None is a superuser, creates a role or a database, or bypasses RLS.

SELECT 'CREATE ROLE core_app NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'core_app') \gexec
SELECT 'CREATE ROLE core_purge NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'core_purge') \gexec

SELECT format('CREATE ROLE %I', :'tool' || '_owner') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'tool' || '_owner') \gexec
SELECT format('CREATE ROLE %I', :'tool' || '_app') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'tool' || '_app') \gexec
SELECT format('CREATE ROLE %I', :'tool' || '_purge') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'tool' || '_purge') \gexec

-- Attributes set on every run (an attribute added by hand is removed; password rotation).
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD %L', :'tool' || '_owner', :'owner_password') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD %L', :'tool' || '_app', :'app_password') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD %L', :'tool' || '_purge', :'purge_password') \gexec

-- Timeouts of the web process (per role, never in postgresql.conf) and closed search_path (CVE-2018-1058).
SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'tool' || '_app', '10s') \gexec
SELECT format('ALTER ROLE %I SET lock_timeout = %L', :'tool' || '_app', '3s') \gexec
SELECT format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', :'tool' || '_app', '10s') \gexec
SELECT format('ALTER ROLE %I SET search_path = app', :'tool' || '_owner') \gexec
SELECT format('ALTER ROLE %I SET search_path = app', :'tool' || '_app') \gexec
SELECT format('ALTER ROLE %I SET search_path = app', :'tool' || '_purge') \gexec

SELECT format('GRANT core_app TO %I', :'tool' || '_app') \gexec
SELECT format('GRANT core_purge TO %I', :'tool' || '_purge') \gexec

-- Database: to the owner; connection refused to everyone but the three roles; no creation in public.
SELECT format('ALTER DATABASE %I OWNER TO %I', :'DBNAME', :'tool' || '_owner') \gexec
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', :'DBNAME') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I', :'DBNAME', :'tool' || '_app', :'tool' || '_purge') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION %I', :'tool' || '_owner') \gexec
