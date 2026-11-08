-- Up Migration
-- ADR-031 (S1): each sentence typed in the chat and how it was read — the person and their hat, the state, the actions
-- the state allowed them (the reader's enum), the sentence verbatim, the answer kept after re-validation (`unclear`
-- included, `amount_usd` with `top_up` only), the reader (model id, or `words` for the fake), its tokens and latency,
-- and whether understanding itself failed (`fallback`: the page went back to the word lists and buttons). Audit trail and
-- evaluation set. The decision is the person's own message (`messages`, `approvals`), never this row. Append-only like
-- the other audit tables (triggers of 0001; the engine reads and inserts through the default grants of 0003).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE intents (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool_id          bigint NOT NULL REFERENCES tools (id),
  cycle_id         bigint NOT NULL REFERENCES cycles (id),
  actor_id         uuid NOT NULL REFERENCES actors (id),
  hat              text NOT NULL CHECK (hat IN ('requester', 'admin')),
  state            text NOT NULL REFERENCES states (id),
  allowed          text[] NOT NULL,
  text             text NOT NULL CHECK (btrim(text) <> ''),
  lang             text NOT NULL CHECK (lang IN ('fr', 'en')),
  pending_question text CHECK (pending_question IS NULL OR btrim(pending_question) <> ''),
  intent           text NOT NULL CHECK (btrim(intent) <> ''),
  amount_usd       numeric(10, 2) CHECK (amount_usd > 0),
  reader           text NOT NULL CHECK (btrim(reader) <> ''),
  input_tokens     integer CHECK (input_tokens >= 0),
  output_tokens    integer CHECK (output_tokens >= 0),
  latency_ms       integer NOT NULL CHECK (latency_ms >= 0),
  fallback         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, tool_id) REFERENCES cycles (id, tool_id),
  CONSTRAINT intents_amount_with_top_up CHECK (amount_usd IS NULL OR intent = 'top_up')
);
CREATE INDEX intents_cycle ON intents (cycle_id, created_at);
CREATE TRIGGER intents_append_only BEFORE UPDATE OR DELETE ON intents
  FOR EACH ROW EXECUTE FUNCTION refuse_modification();
CREATE TRIGGER intents_no_truncate BEFORE TRUNCATE ON intents FOR EACH STATEMENT EXECUTE FUNCTION refuse_modification();

-- Down Migration
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP TABLE intents;
