-- Up Migration
-- E1 (M9): one row per notification sent, under its idempotency key (workflow + step
-- + message key, or visit + reminder number). The SMTP adapter inserts the row and sends the mail in ONE transaction: a
-- key already there never goes out again (an engine killed after sending, a replayed DBOS step, a late attempt that
-- succeeds at the same time as its retry: the second one's INSERT waits for the first one's COMMIT, then does nothing).
-- Append-only: the engine gets SELECT, INSERT through the default grants (0003), never UPDATE or DELETE (deleting a
-- row would make the mail go out again).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE sent_notifications (
  key       text PRIMARY KEY CHECK (btrim(key) <> ''),
  cycle_id  bigint NOT NULL REFERENCES cycles (id),
  recipient text NOT NULL CHECK (recipient IN ('admin', 'requester')),
  sent_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sent_notifications_cycle ON sent_notifications (cycle_id);

-- Down Migration
DROP TABLE sent_notifications;
