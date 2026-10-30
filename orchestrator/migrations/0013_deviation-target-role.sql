-- Up Migration
-- A-R2a (ADR-021): a builder finding whose `owner_role` is `tests` becomes a deviation routed to the tests role, whatever
-- its file (the builder may cite the line of the contract or the route: the file alone would send it back to the builder). The role
-- that must fix it is kept in the database, readable by the admin. NULL = usual routing (file, rule, source). Nullable
-- column without a default: no rewrite of the table. Never an existing migration changed (ADR-004).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE deviations ADD COLUMN target_role text CONSTRAINT deviations_target_role_check CHECK (target_role IS NULL OR target_role IN ('tests', 'builder'));

-- Down Migration
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE deviations DROP COLUMN target_role;
