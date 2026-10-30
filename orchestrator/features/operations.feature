# Tag @to-wire = scenario without Cucumber step definitions for now (excluded from `pnpm test:bdd`).
# Scenarios 42 to 47 of docs/orchestrator-scenarios.md — outside the W1 machine: decommissioning (W5),
# weekly summary (W6), task queue (W2). No transition of the cycle to cover here.
Feature: Operations
  The decommissioning moves forward by steps recomputed every day (D83 alert, D90 reminder,
  D97 official notice, D104 quarantine then archiving instruction), reset to zero by a
  real access. The weekly summary and the task queue with concurrency N complete the operations.

  Background:
    Given the default thresholds
    And the fake agent engine

  @to-wire
  Scenario: 42. A tool without access since D83 receives the alert, then each step only once
    Given a tool in production whose last real access was 83 days ago
    When the daily decommissioning check runs
    Then the fake mail server has sent the owning department a message whose subject contains "no access for 83 days"
    When the daily decommissioning check runs
    Then the fake mail server has sent no new message
    When 7 days pass without a real access
    And the daily decommissioning check runs
    Then the fake mail server has sent the owning department a message whose subject contains "D90"
    And table "tool_history" contains exactly one entry for step "D83" of the tool
    And table "tool_history" contains exactly one entry for step "D90" of the tool

  @to-wire
  Scenario: 43. A real access after D90 resets the decommissioning to zero without sending any mail
    Given a tool in production at decommissioning step "D90"
    When a signed-in user accesses the tool
    And the daily decommissioning check runs
    Then the tool is no longer being decommissioned
    And the fake mail server has sent no new message
    When the platform's health check queries the tool
    And the daily decommissioning check runs
    Then the tool's last real access has not changed

  @to-wire
  Scenario: 44. A tool already beyond D104 at the first check receives the official notice before the archiving instruction
    Given a tool in production whose last real access was 120 days ago
    And no decommissioning step recorded for this tool
    When the daily decommissioning check runs
    Then the fake mail server has sent the owning department a message whose subject contains "official notice"
    And no archiving instruction is issued for the tool
    When 7 days pass without a real access
    And the daily decommissioning check runs
    Then an archiving instruction is issued for the tool

  @to-wire
  Scenario: 45. The quarantine really stops the deployment without deleting the data
    Given a tool in production with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    And this tool at decommissioning step "D97" without a real access for 104 days
    When the daily decommissioning check runs
    Then table "deployments" contains a "quarantine" deployment of digest "sha256:1111111111111111111111111111111111111111111111111111111111111111" with health "ok"
    And the tool no longer answers in production
    And the tool's database is intact
    And no data of the cycle is deleted
    And the tool is not archived

  @to-wire
  Scenario: 46. The weekly summary lists costs, tasks, delivered tools and gates waiting for more than 72 h
    Given a tool delivered to production this week after 12 agent tasks for 9.80 $
    And a creation cycle in state "gate_1" for tool "car-fleet" without an answer from the admin for 80 hours
    And a creation cycle in state "gate_2" for tool "badges" without an answer from the admin for 10 hours
    When the weekly summary is produced
    Then the weekly summary contains "9.80 $"
    And the weekly summary contains "12 tasks"
    And the weekly summary lists tool "inventory" among the delivered tools
    And the weekly summary lists tool "car-fleet" among the gates waiting for more than 72 h
    And the weekly summary does not list tool "badges" among the gates waiting for more than 72 h
    And the fake mail server has sent the admin a message whose subject contains "Weekly summary"

  @to-wire
  Scenario: 47. At N = 1, the tasks of two tools run in the order of the queue, without interference
    Given a task queue with concurrency 1
    And a creation cycle in state "scoping" for tool "inventory"
    And a creation cycle in state "scoping" for tool "car-fleet"
    Then task "scoping" of iteration 1 of tool "inventory" has status "in_progress"
    And task "scoping" of iteration 1 of tool "car-fleet" has status "queued"
    And there is exactly one agent container running
    When the fake engine returns a compliant report for "scoping" for tool "inventory"
    Then task "scoping" of iteration 1 of tool "car-fleet" has status "in_progress"
    And the container of task "scoping" of iteration 1 of tool "car-fleet" mounts no file of tool "inventory"
    And task "scoping" of iteration 1 of tool "car-fleet" has no message of tool "inventory" in its context
