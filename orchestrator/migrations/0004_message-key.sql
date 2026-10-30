-- Up Migration
-- Idempotency key of a message written by the orchestrator (e.g. reminder "visit + number"): a W1 replayed from the
-- start (repair of the path) never writes the same message twice in the chat. Without a key: no check.
ALTER TABLE messages ADD COLUMN key text UNIQUE;

-- Down Migration
ALTER TABLE messages DROP COLUMN key;
