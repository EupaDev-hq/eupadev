-- Database and PostgreSQL account of Keycloak (D9, docs/reflexions/2026-10-15-analyse-keycloak.md).
-- Idempotent, replayed on every pass by the image's superuser, in the PostgreSQL of the
-- orchestrator; password as a psql variable (\set on standard input), never here.
--   keycloak: owner of its own database only; neither superuser, nor creation of roles or databases.
-- pg_hba (role orchestrator): the keycloak account enters only the keycloak database, over TLS.

SELECT 'CREATE ROLE keycloak' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'keycloak') \gexec
ALTER ROLE keycloak WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'keycloak_password';

SELECT 'CREATE DATABASE keycloak OWNER keycloak' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak') \gexec
ALTER DATABASE keycloak OWNER TO keycloak;
-- The orchestrator's accounts have nothing to do in Keycloak's database.
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
