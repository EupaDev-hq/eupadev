-- Up Migration
-- ADR-027: the `diagnosis` task (its own iteration counter, outside the hardening rounds) no longer counts as a
-- hardening round in `cycle_measures`; its cost stays in `hardening_cost_usd` (spent by the cycle, D16). Same view as
-- 0009 otherwise; CREATE OR REPLACE keeps the privileges (REVOKE of 0009).
CREATE OR REPLACE VIEW cycle_measures AS
SELECT
  c.id AS cycle_id,
  o.slug AS tool,
  c.type,
  c.state,
  c.created_at,
  c.finished_at,
  c.finished_at - c.created_at AS calendar_duration,
  t.scoping_cost_usd + t.hardening_cost_usd AS total_cost_usd,
  t.scoping_cost_usd,
  t.hardening_cost_usd,
  t.input_tokens,
  t.output_tokens,
  t.work_duration_min,
  t.tasks,
  t.failed_tasks,
  t.blocked_tasks,
  t.hardening_rounds,
  (SELECT h.trigger = 'event:ci_finished:green' FROM tool_history h
   WHERE h.cycle_id = c.id AND h.trigger IN ('event:ci_finished:green', 'event:ci_finished:red')
   ORDER BY h.id LIMIT 1) AS first_ci_pass_green,
  (SELECT count(*)::int FROM deviations e WHERE e.cycle_id = c.id) AS deviations,
  NULL::int AS confirmed_blocking_deviations,
  NULL::int AS debt_deviations,
  (SELECT count(*)::int FROM approvals a WHERE a.cycle_id = c.id) AS gate_decisions
FROM cycles c
JOIN tools o ON o.id = c.tool_id
CROSS JOIN LATERAL (
  SELECT
    CASE WHEN bool_or(x.is_open AND x.scoping) THEN NULL
         ELSE coalesce(sum(x.cost_usd) FILTER (WHERE x.scoping), 0) END AS scoping_cost_usd,
    CASE WHEN bool_or(x.is_open AND NOT x.scoping) THEN NULL
         ELSE coalesce(sum(x.cost_usd) FILTER (WHERE NOT x.scoping), 0) END AS hardening_cost_usd,
    CASE WHEN bool_or(x.is_open OR x.executions > 1 OR (x.executions = 1 AND x.input_tokens = 0)) THEN NULL
         ELSE coalesce(sum(x.input_tokens), 0) END AS input_tokens,
    CASE WHEN bool_or(x.is_open OR x.executions > 1 OR (x.executions = 1 AND x.input_tokens = 0)) THEN NULL
         ELSE coalesce(sum(x.output_tokens), 0) END AS output_tokens,
    CASE WHEN bool_or(x.is_open OR x.executions > 1 OR (x.executions = 1 AND x.duration_s = 0)) THEN NULL
         ELSE round(coalesce(sum(x.duration_s), 0) / 60.0, 2) END AS work_duration_min,
    count(*)::int AS tasks,
    count(*) FILTER (WHERE x.status = 'failed')::int AS failed_tasks,
    count(*) FILTER (WHERE x.status = 'blocked')::int AS blocked_tasks,
    count(DISTINCT x.iteration) FILTER (WHERE x.role NOT IN ('overlap', 'scoping', 'contract', 'diagnosis'))::int AS hardening_rounds
  FROM (
    SELECT status, role, iteration, executions, cost_usd, input_tokens, output_tokens, duration_s,
           status IN ('queued', 'in_progress') AS is_open, role IN ('overlap', 'scoping') AS scoping
    FROM tasks WHERE cycle_id = c.id
  ) x
) t;

-- Down Migration
-- The view of 0009 (diagnosis counted among the rounds again); nothing is lost.
CREATE OR REPLACE VIEW cycle_measures AS
SELECT
  c.id AS cycle_id,
  o.slug AS tool,
  c.type,
  c.state,
  c.created_at,
  c.finished_at,
  c.finished_at - c.created_at AS calendar_duration,
  t.scoping_cost_usd + t.hardening_cost_usd AS total_cost_usd,
  t.scoping_cost_usd,
  t.hardening_cost_usd,
  t.input_tokens,
  t.output_tokens,
  t.work_duration_min,
  t.tasks,
  t.failed_tasks,
  t.blocked_tasks,
  t.hardening_rounds,
  (SELECT h.trigger = 'event:ci_finished:green' FROM tool_history h
   WHERE h.cycle_id = c.id AND h.trigger IN ('event:ci_finished:green', 'event:ci_finished:red')
   ORDER BY h.id LIMIT 1) AS first_ci_pass_green,
  (SELECT count(*)::int FROM deviations e WHERE e.cycle_id = c.id) AS deviations,
  NULL::int AS confirmed_blocking_deviations,
  NULL::int AS debt_deviations,
  (SELECT count(*)::int FROM approvals a WHERE a.cycle_id = c.id) AS gate_decisions
FROM cycles c
JOIN tools o ON o.id = c.tool_id
CROSS JOIN LATERAL (
  SELECT
    CASE WHEN bool_or(x.is_open AND x.scoping) THEN NULL
         ELSE coalesce(sum(x.cost_usd) FILTER (WHERE x.scoping), 0) END AS scoping_cost_usd,
    CASE WHEN bool_or(x.is_open AND NOT x.scoping) THEN NULL
         ELSE coalesce(sum(x.cost_usd) FILTER (WHERE NOT x.scoping), 0) END AS hardening_cost_usd,
    CASE WHEN bool_or(x.is_open OR x.executions > 1 OR (x.executions = 1 AND x.input_tokens = 0)) THEN NULL
         ELSE coalesce(sum(x.input_tokens), 0) END AS input_tokens,
    CASE WHEN bool_or(x.is_open OR x.executions > 1 OR (x.executions = 1 AND x.input_tokens = 0)) THEN NULL
         ELSE coalesce(sum(x.output_tokens), 0) END AS output_tokens,
    CASE WHEN bool_or(x.is_open OR x.executions > 1 OR (x.executions = 1 AND x.duration_s = 0)) THEN NULL
         ELSE round(coalesce(sum(x.duration_s), 0) / 60.0, 2) END AS work_duration_min,
    count(*)::int AS tasks,
    count(*) FILTER (WHERE x.status = 'failed')::int AS failed_tasks,
    count(*) FILTER (WHERE x.status = 'blocked')::int AS blocked_tasks,
    count(DISTINCT x.iteration) FILTER (WHERE x.role NOT IN ('overlap', 'scoping', 'contract'))::int AS hardening_rounds
  FROM (
    SELECT status, role, iteration, executions, cost_usd, input_tokens, output_tokens, duration_s,
           status IN ('queued', 'in_progress') AS is_open, role IN ('overlap', 'scoping') AS scoping
    FROM tasks WHERE cycle_id = c.id
  ) x
) t;
