-- Up Migration
-- Browser sessions of the requester's web page (ADR-024): the
-- engine signs the person in with Keycloak (client `eupadev-web`, code + PKCE, server side) and gives the browser a
-- `__Host-session` cookie holding a 32-byte random token. Only SHA-256(token) is stored: a database read never yields a
-- usable cookie. No OIDC token is kept: the identity is already resolved to `actor_id` (ADR-017), the hats are frozen for
-- the session (30 min idle, 8 h at most, like the core). Sessions are the only rows the engine deletes (sign-out, expiry):
-- explicit grant, the default privileges of 0003 give read and insert only.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE sessions (
  token_hash          bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  actor_id            uuid NOT NULL REFERENCES actors (id),
  roles               text[] NOT NULL CHECK (cardinality(roles) > 0 AND roles <@ ARRAY['requester', 'admin']),
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_actor ON sessions (actor_id);
CREATE INDEX sessions_expiration ON sessions (absolute_expires_at);

GRANT UPDATE (last_seen_at, idle_expires_at), DELETE ON sessions TO orch_engine;

-- Down Migration
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP TABLE sessions;
