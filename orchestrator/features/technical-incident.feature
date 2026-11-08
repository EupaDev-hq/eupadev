# Decision D21 of ROADMAP.md §8.13 — gate "technical incident", the engine's safety net.
# Tag @t:<from>--<trigger>--><to> = transition of src/machine/states.ts covered (tests/feature-coverage.test.ts);
# hooks.ts also checks that each announced transition was really traced by the scenario.
Feature: Technical incident
  An unexpected internal error (database unavailable after the retries, outside service down, unexpected
  message, bug) never makes a cycle die silently: the workflow stays alive, the admin receives the exact
  error at the gate "technical incident" and chooses to retry (back to the state of origin, and to it only),
  to refuse or to cancel. Reminders 24/48/72 h like any gate (scenario 41).

  Background:
    Given the default thresholds
    And the fake agent engine

  @t:<state>--incident-->gate_incident
  @t:gate_incident--resume:<state>--><state>
  Scenario Outline: D21. An internal error in state "<state>" opens the incident gate with the exact error; "retry" resumes that state
    Given a creation cycle driven to state "<state>" whose exit fails with error "simulated fault: disk full"
    Then the cycle moves from "<state>" to "gate_incident" by "incident"
    And the notification sent to the admin contains "Technical incident in state <state>"
    And the notification sent to the admin contains "simulated fault: disk full"
    And the cycle's workflow is still running
    When the admin decides "approved" at gate "gate_incident"
    Then the cycle moves from "gate_incident" to "<state>" by "resume:<state>"
    And table "approvals" contains a "approved" decision for gate "gate_incident"

    Examples:
      | state                    |
      | request_received         |
      | overlap_search           |
      | gate_overlap             |
      | repo_creation            |
      | scoping                  |
      | gate_scoping_budget      |
      | gate_scoping_blocked     |
      | mockup_deployment        |
      | waiting_scoping_feedback |
      | scoping_pause            |
      | contract                 |
      | gate_contract_blocked    |
      | hardening_execution      |
      | hardening_integration    |
      | hardening_review         |
      | hardening_evaluation     |
      | gate_hardening_blocked   |
      | merge                    |
      | waiting_ci               |
      | candidate_image          |
      | gate_1                   |
      | preview_deployment       |
      | waiting_preview_feedback |
      | preview_pipeline         |
      | gate_2                   |
      | prod_deployment          |
      | gate_delivery_blocked    |
      | gate_prod_blocked        |

  @t:gate_contract_blocked--incident-->gate_incident
  @t:gate_incident--resume:gate_contract_blocked-->gate_contract_blocked
  @t:contract--incident-->gate_incident
  @t:gate_incident--resume:contract-->contract
  Scenario: D21 ter. The resumed gate shows its own reason again; a second incident in the same cycle goes back to its own origin
    Given a creation cycle driven to state "gate_contract_blocked" whose exit fails with error "simulated fault: disk full"
    Then the cycle moves from "gate_contract_blocked" to "gate_incident" by "incident"
    When the admin decides "approved" at gate "gate_incident"
    Then the cycle moves from "gate_incident" to "gate_contract_blocked" by "resume:gate_contract_blocked"
    And the notification sent to the admin contains "Contract failed: invalid openapi: paths missing"
    When an internal error occurs when leaving state "contract" with error "simulated fault: network cut"
    And the admin decides "approved" at gate "gate_contract_blocked"
    Then the cycle moves from "gate_contract_blocked" to "contract" by "gate:approved"
    And the cycle moves from "contract" to "gate_incident" by "incident"
    And the notification sent to the admin contains "simulated fault: network cut"
    When the admin decides "approved" at gate "gate_incident"
    Then the cycle moves from "gate_incident" to "contract" by "resume:contract"
    And the cycle moves from "contract" to "hardening_execution" by "task:done"

  @t:hardening_execution--incident-->gate_incident
  @t:gate_incident--resume:hardening_execution-->hardening_execution
  Scenario: D21 quater. A workflow dead while tasks run: the monitoring stops them (started: cap); "retry" really restarts the round
    Given a creation cycle in state "hardening_execution"
    And an agent task of the cycle running if the state launches one
    When the cycle's workflow dies while the cycle waits for its tasks
    Then the cycle moves from "hardening_execution" to "gate_incident" by "incident"
    And the notification sent to the admin contains "Technical incident in state hardening_execution"
    And no agent container of the cycle is running
    # A-R2a: the tests task was running; the builder, started only after it, does not exist yet.
    And task "tests" of iteration 1 has status "failed"
    And task "tests" of iteration 1 has a cost of 10 $
    And table "tasks" contains no "builder" task for iteration 1
    When the admin decides "approved" at gate "gate_incident"
    Then the cycle moves from "gate_incident" to "hardening_execution" by "resume:hardening_execution"
    And table "tasks" contains exactly one "tests" task for iteration 2

  Scenario: D21 quinquies. A workflow dead during the review: the started task is counted at the cap, the one left in the queue at 0 $
    Given a creation cycle in state "hardening_review"
    And an agent task of the cycle running if the state launches one
    When the cycle's workflow dies while the cycle waits for its tasks
    Then the cycle moves from "hardening_review" to "gate_incident" by "incident"
    And no agent container of the cycle is running
    # N = 1: the first reviewer of the queue was running, the second one waited behind it.
    And task "security-reviewer" of iteration 1 has status "failed"
    And task "security-reviewer" of iteration 1 has a cost of 10 $
    And task "quality-reviewer" of iteration 1 has status "failed"
    And task "quality-reviewer" of iteration 1 has a cost of 0 $

  # Paid cycle 9: two tasks paused then resumed were charged a cap each although no container had run.
  Scenario: D21 sexies. A task stopped while the launcher was still preparing it (no container started) costs 0 $, not the cap
    Given the fake engine is still preparing the "tests" tasks, their container not started
    And a creation cycle in state "hardening_execution"
    When the admin cancels the cycle
    Then the cycle moves from "hardening_execution" to "end_cancellation" by "cancellation"
    And task "tests" of iteration 1 has status "failed"
    And task "tests" of iteration 1 has a cost of 0 $
    And the recorded reason of task "tests" of iteration 1 is "cancellation"

  Scenario: D21 bis. After "retry", the state of origin is processed again from the start and the cycle runs to the end
    Given a creation cycle driven to state "scoping" whose exit fails with error "simulated fault: connection lost"
    Then the cycle moves from "scoping" to "gate_incident" by "incident"
    When the admin decides "approved" at gate "gate_incident"
    Then the cycle moves from "gate_incident" to "scoping" by "resume:scoping"
    And table "tasks" contains exactly one "scoping" task for iteration 2
    And the cycle moves from "scoping" to "mockup_deployment" by "task:done"
    And the cycle moves from "mockup_deployment" to "waiting_scoping_feedback" by "task:done"
