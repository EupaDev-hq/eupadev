-- Up Migration
-- Launcher, step 0: what allows comparing the cost per successful
-- task at equal model, effort and instructions (ROADMAP no. 25 (c), §8.15, launcher).
-- - model, effort: configuration of the role, written by W2 when the task starts, then fixed.
-- - instructions_sha256: sha256 of the exact text of the instructions passed to the engine, computed by W2 (outside the container), fixed.
-- - verdict_source: 'agent' when the task closes as done (the agent's report is the only judge); 'ci' when the CI of
--   the branch has answered, only once. Nothing else: a task that is not done has no verdict.
-- Optional columns (NULL for the tasks from before this migration): no backfill, no rewrite of the table.
-- The CHECKs are verified by a scan of `tasks` (small table) under an exclusive lock, bounded by lock_timeout
-- (ADR-004; node-pg-migrate runs each SQL migration in a transaction, hence SET LOCAL).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE tasks
  ADD COLUMN model text CHECK (btrim(model) <> ''),
  ADD COLUMN effort text CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  ADD COLUMN instructions_sha256 text CHECK (instructions_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN verdict_source text CHECK (verdict_source IN ('agent', 'ci')),
  ADD CONSTRAINT tasks_verdict_if_done CHECK (verdict_source IS NULL OR status = 'done');

-- M8 (0001), completed: model, effort and instructions digest are fixed once written; a closed task no longer
-- changes, except the single move of verdict_source from 'agent' to 'ci' (all the rest of the row identical).
CREATE OR REPLACE FUNCTION tasks_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tasks: deletion refused (task %)', OLD.id;
  END IF;
  IF (NEW.id, NEW.tool_id, NEW.cycle_id, NEW.step, NEW.role, NEW.iteration, NEW.attempt, NEW.branch, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tool_id, OLD.cycle_id, OLD.step, OLD.role, OLD.iteration, OLD.attempt, OLD.branch, OLD.created_at) THEN
    RAISE EXCEPTION 'tasks: the identity of task % is immutable', OLD.id;
  END IF;
  IF (OLD.model IS NOT NULL AND NEW.model IS DISTINCT FROM OLD.model)
     OR (OLD.effort IS NOT NULL AND NEW.effort IS DISTINCT FROM OLD.effort)
     OR (OLD.instructions_sha256 IS NOT NULL AND NEW.instructions_sha256 IS DISTINCT FROM OLD.instructions_sha256) THEN
    RAISE EXCEPTION 'tasks: model, effort and instructions digest of task % are fixed once written', OLD.id;
  END IF;
  IF OLD.status IN ('done', 'blocked', 'failed') THEN
    IF OLD.verdict_source = 'agent' AND NEW.verdict_source = 'ci'
       AND to_jsonb(NEW) - 'verdict_source' = to_jsonb(OLD) - 'verdict_source' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'tasks: task % closed (%), nothing changes any more (cost set at closing; verdict_source goes once from agent to ci)', OLD.id, OLD.status;
  END IF;
  IF NEW.status IN ('queued', 'in_progress') AND NEW.cost_usd IS DISTINCT FROM OLD.cost_usd THEN
    RAISE EXCEPTION 'tasks: the cost of task % is set when it closes, not before', OLD.id;
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status = 'queued' THEN
    RAISE EXCEPTION 'tasks: a started task does not go back to the queue (%)', OLD.id;
  END IF;
  IF NEW.executions < OLD.executions THEN
    RAISE EXCEPTION 'tasks: the number of executions of task % does not decrease', OLD.id;
  END IF;
  RETURN NEW;
END
$$;

-- Down Migration
CREATE OR REPLACE FUNCTION tasks_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tasks: deletion refused (task %)', OLD.id;
  END IF;
  IF (NEW.id, NEW.tool_id, NEW.cycle_id, NEW.step, NEW.role, NEW.iteration, NEW.attempt, NEW.branch, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tool_id, OLD.cycle_id, OLD.step, OLD.role, OLD.iteration, OLD.attempt, OLD.branch, OLD.created_at) THEN
    RAISE EXCEPTION 'tasks: the identity of task % is immutable', OLD.id;
  END IF;
  IF OLD.status IN ('done', 'blocked', 'failed') THEN
    RAISE EXCEPTION 'tasks: task % closed (%), nothing changes any more (cost set at closing)', OLD.id, OLD.status;
  END IF;
  IF NEW.status IN ('queued', 'in_progress') AND NEW.cost_usd IS DISTINCT FROM OLD.cost_usd THEN
    RAISE EXCEPTION 'tasks: the cost of task % is set when it closes, not before', OLD.id;
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status = 'queued' THEN
    RAISE EXCEPTION 'tasks: a started task does not go back to the queue (%)', OLD.id;
  END IF;
  IF NEW.executions < OLD.executions THEN
    RAISE EXCEPTION 'tasks: the number of executions of task % does not decrease', OLD.id;
  END IF;
  RETURN NEW;
END
$$;
ALTER TABLE tasks DROP CONSTRAINT tasks_verdict_if_done,
  DROP COLUMN verdict_source, DROP COLUMN instructions_sha256, DROP COLUMN effort, DROP COLUMN model;
