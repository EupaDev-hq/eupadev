-- Up Migration
-- Launcher: result of the agents' CI (docs/reflexions/2026-10-13-note-lanceur.md: only the tasks with a green ci
-- count as successful). 0005 recorded that the CI had answered (verdict_source = 'ci'), not what it said.
-- - ci_green: NULL while the CI has not answered; true/false written with verdict_source = 'ci', in the same UPDATE
--   (Database.ciVerdict), then fixed.
-- - tasks_ci_green_if_ci: ci_green not NULL if and only if verdict_source = 'ci'. No row has 'ci' before this
--   migration (ciVerdict has no caller outside the scenarios): the constraint is added without backfill.
-- Optional column, no default: no rewrite of the table; the CHECK scans `tasks` (small table) under an
-- exclusive lock, bounded by lock_timeout (as 0005).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE tasks
  ADD COLUMN ci_green boolean,
  ADD CONSTRAINT tasks_ci_green_if_ci CHECK ((ci_green IS NOT NULL) = (verdict_source IS NOT DISTINCT FROM 'ci'));

-- Trigger of 0005, the only difference: the single agent → ci move also writes ci_green (all the rest identical).
CREATE OR REPLACE FUNCTION tasks_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tasks: deletion refused (task %)', OLD.id;
  END IF;
  IF (NEW.id, NEW.tool_id, NEW.cycle_id, NEW.step, NEW.role, NEW.iteration, NEW.attempt, NEW.branch, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tool_id, OLD.cycle_id, OLD.step, OLD.role, OLD.iteration, OLD.attempt, OLD.branch, OLD.created_at) THEN
    RAISE EXCEPTION 'tasks: the identity of task % is immutable', OLD.id;
  END IF;
  -- M8 completed by 0005: what describes the run is fixed once written.
  IF (OLD.model IS NOT NULL AND NEW.model IS DISTINCT FROM OLD.model)
     OR (OLD.effort IS NOT NULL AND NEW.effort IS DISTINCT FROM OLD.effort)
     OR (OLD.instructions_sha256 IS NOT NULL AND NEW.instructions_sha256 IS DISTINCT FROM OLD.instructions_sha256) THEN
    RAISE EXCEPTION 'tasks: model, effort and instructions digest of task % are fixed once written', OLD.id;
  END IF;
  IF OLD.status IN ('done', 'blocked', 'failed') THEN
    -- ci_green goes from NULL to its value in the same UPDATE (constraint tasks_ci_green_if_ci), then no longer changes.
    IF OLD.verdict_source = 'agent' AND NEW.verdict_source = 'ci'
       AND to_jsonb(NEW) - 'verdict_source' - 'ci_green' = to_jsonb(OLD) - 'verdict_source' - 'ci_green' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'tasks: task % closed (%), nothing changes any more (cost set at closing; verdict_source goes once from agent to ci, with ci_green)', OLD.id, OLD.status;
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
-- Function of 0005, unchanged.
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
ALTER TABLE tasks DROP CONSTRAINT tasks_ci_green_if_ci, DROP COLUMN ci_green;
