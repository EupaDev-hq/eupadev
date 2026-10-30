-- Purge of "requests", run by the core's bin/purge.js with the purge account (SELECT, DELETE), in its transaction,
-- after the core's own purge. Each period comes from the environment (RETENTION_REQUESTS, RETENTION_DRAFTS,
-- RETENTION_DELETED, RETENTION_HISTORY; docs/DECISIONS.md), with no default value.

-- Soft-deleted requests once their restore delay (RETENTION_DELETED) is over, or finished for more than
-- RETENTION_REQUESTS: personal data first (details, attachment), then the row. A finished request no longer changes:
-- updated_at dates its closing.
-- Abandoned drafts (never submitted) go RETENTION_DRAFTS after their last change: every edit updates requests.
DELETE FROM request_details WHERE request_id IN (SELECT id FROM requests WHERE deleted_at < now() - current_setting('purge.retention_deleted')::interval
  OR (status IN ('resolved', 'rejected', 'cancelled') AND updated_at < now() - current_setting('purge.retention_requests')::interval)
  OR (status = 'draft' AND updated_at < now() - current_setting('purge.retention_drafts')::interval));
DELETE FROM request_attachments WHERE request_id IN (SELECT id FROM requests WHERE deleted_at < now() - current_setting('purge.retention_deleted')::interval
  OR (status IN ('resolved', 'rejected', 'cancelled') AND updated_at < now() - current_setting('purge.retention_requests')::interval)
  OR (status = 'draft' AND updated_at < now() - current_setting('purge.retention_drafts')::interval));
DELETE FROM requests WHERE deleted_at < now() - current_setting('purge.retention_deleted')::interval
  OR (status IN ('resolved', 'rejected', 'cancelled') AND updated_at < now() - current_setting('purge.retention_requests')::interval)
  OR (status = 'draft' AND updated_at < now() - current_setting('purge.retention_drafts')::interval);

-- Business history: row by row beyond RETENTION_HISTORY, whether the request still exists or not.
DELETE FROM request_history WHERE at < now() - current_setting('purge.retention_history')::interval;
