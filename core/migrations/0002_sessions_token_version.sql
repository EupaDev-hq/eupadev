-- Up Migration
-- Step 4 (OIDC, sessions): the actor's token version seen at sign-in, compared with actors.token_version in the
-- session read query (ASVS 7.4.2); an UPDATE of actors.token_version invalidates every session of the actor on
-- every instance. Expansion only (ADR-004, ADR-019).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE sessions ADD COLUMN token_version bigint NOT NULL DEFAULT 1 CHECK (token_version >= 1);
