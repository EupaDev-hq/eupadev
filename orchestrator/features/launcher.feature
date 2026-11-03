# Agent launcher, step 0: contract and database,
# with the fake engine, no AI. What the task records to compare the cost per successful task (ROADMAP no. 25 (c)).
Feature: Measurement of the agent tasks
  Each task records the model, the effort and the digest of the instructions it ran with; the engine receives
  exactly these values and the task's branch. The verdict of a successful task comes first from the agent, then from the
  CI of its branch, only once, with its result (green or red): only the green "ci" tasks count as
  successful.

  Background:
    Given the default thresholds
    And the fake agent engine

  Scenario: L0-1. The task records model, effort and instructions digest as soon as it starts, then never changes them
    Given a creation cycle in state "overlap_search"
    Then task "overlap" of iteration 1 records its role's model and effort and the digest of the instructions the engine received
    And the instructions the engine received for task "overlap" of iteration 1 are the role's instructions in the template
    And the engine received for task "overlap" of iteration 1 this model, this effort and branch "agent/<tool>/<cycle>/overlap"
    And the engine received for task "overlap" of iteration 1 its role's caps (duration, turns, budget)
    And the database refuses to change the model, the effort or the digest of task "overlap" of iteration 1
    When the fake engine returns verdict "not_plausible" for "overlap" with 1200 input tokens and 340 output tokens
    Then the cycle moves from "overlap_search" to "repo_creation" by "guard:not_plausible"
    And task "overlap" of iteration 1 records 1200 input tokens and 340 output tokens
    And task "overlap" of iteration 1 records its role's model and effort and the digest of the instructions the engine received

  Scenario: L0-2. Green CI: the verdict of a successful task moves from "agent" to "ci" with the result, changing nothing else
    Given a creation cycle in state "overlap_search"
    When the fake engine returns verdict "not_plausible" for "overlap"
    Then the cycle moves from "overlap_search" to "repo_creation" by "guard:not_plausible"
    And task "overlap" of iteration 1 has verdict "agent"
    And the database refuses to set the verdict of task "overlap" of iteration 1 to "ci" while also changing its cost
    And the database refuses to set the verdict of task "overlap" of iteration 1 to "ci" without the CI result
    When the CI of the branch of task "overlap" of iteration 1 answers "green"
    Then task "overlap" of iteration 1 has verdict "ci" and a "green" CI

  Scenario: L0-3. A failed task has no verdict, and the CI does not give it one
    Given a creation cycle in state "overlap_search"
    When the fake engine returns a failure for "overlap" with reason "container stopped"
    Then the cycle moves from "overlap_search" to "gate_overlap" by "task:failed"
    And task "overlap" of iteration 1 has no verdict
    When the CI of the branch of task "overlap" of iteration 1 answers "green"
    Then task "overlap" of iteration 1 has no verdict

  Scenario: L0-4. Red CI: the task has the verdict "ci" and the red result recorded
    Given a creation cycle in state "overlap_search"
    When the fake engine returns verdict "not_plausible" for "overlap"
    Then the cycle moves from "overlap_search" to "repo_creation" by "guard:not_plausible"
    When the CI of the branch of task "overlap" of iteration 1 answers "red"
    Then task "overlap" of iteration 1 has verdict "ci" and a "red" CI

  Scenario: L0-5. A second verdict of the CI is refused: the first one stays
    Given a creation cycle in state "overlap_search"
    When the fake engine returns verdict "not_plausible" for "overlap"
    Then the cycle moves from "overlap_search" to "repo_creation" by "guard:not_plausible"
    When the CI of the branch of task "overlap" of iteration 1 answers "green"
    Then a new "red" answer from the CI does not change the verdict of task "overlap" of iteration 1
    And task "overlap" of iteration 1 has verdict "ci" and a "green" CI

  Scenario: L0-6. The CI result is frozen: the database refuses any change to the verdict or the result
    Given a creation cycle in state "overlap_search"
    When the fake engine returns verdict "not_plausible" for "overlap"
    Then the cycle moves from "overlap_search" to "repo_creation" by "guard:not_plausible"
    When the CI of the branch of task "overlap" of iteration 1 answers "red"
    Then the database refuses any further change to the verdict or CI result of task "overlap" of iteration 1
    And task "overlap" of iteration 1 has verdict "ci" and a "red" CI
