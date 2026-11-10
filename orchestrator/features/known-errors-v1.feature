# "[orchestrator test]" checks of ROADMAP.md §8.12 (known errors E1 to E15 of v1) that are not
# already covered by the numbered scenarios of the other files. E6, E12 and E13 are not tests of
# the orchestrator (unit tests, agent launcher, architecture).
# Tag @t:<from>--<trigger>--><to> = transition of src/machine/states.ts covered (tests/feature-coverage.test.ts).
# Tag @to-wire = scenario without Cucumber step definitions for now (excluded from `pnpm test:bdd`, counted by tests/feature-coverage.test.ts).
Feature: Known errors of v1
  Every guard-rail made silent, duplicate, loss of context or missing configuration of v1
  becomes a test that fails loudly if the error comes back.

  Background:
    Given the default thresholds
    And the fake agent engine

  Scenario Outline: E1. The hardening guard-rail "<guard_rail>" triggers and escalates to the admin
    Given a creation cycle in state "hardening_execution"
    And <situation>
    When the fake engine declares a cost of 3 $ per task
    And the next hardening round is played with, for "security-reviewer", the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    Then the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "<guard_rail>"
    And table "tasks" contains no task for the next iteration

    Examples:
      | guard_rail | situation                                                                                           |
      | stagnation | deviation "SEC-IDOR" on "api/tools.js" present in the last 2 rounds                                 |
      | cap        | 24 hardening rounds already played, each with fewer deviations than the previous one, all different |
      | duration   | a cumulative agent work duration of 240 minutes on the cycle                                        |
      | budget     | a cumulative cycle cost of 40 $                                                                     |

  Scenario: E1 bis. The agent work duration of the scoping escalates too
    Given a creation cycle in state "scoping"
    And a cumulative agent work duration of 240 minutes on the cycle
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    Then the cycle moves from "scoping" to "gate_scoping_blocked" by "guard:escalation"
    And the notification sent to the admin contains "duration"

  Scenario: E2. Each round is preceded by a traced budget check
    Given a creation cycle in state "waiting_scoping_feedback"
    When the requester sends scoping feedback "satisfied"
    And the fake engine returns a compliant report for "contract"
    Then table "tool_history" contains a budget check for step "contract" before the launch of task "contract" of iteration 1
    And table "tool_history" contains a budget check for step "hardening_execution" before the launch of task "tests" of iteration 1
    And table "tool_history" contains no budget check between task "tests" and task "builder" of iteration 1

  @to-wire
  Scenario Outline: E3. The first pass of phase "<phase>" on an empty database stops neither silently nor without a result
    Given an empty database
    And a creation cycle in state "<state>"
    When the fake engine returns a compliant report for "<role>"
    Then the cycle is in state "<next>"
    And table "tasks" contains exactly one "<role>" task for iteration 1
    And the orchestrator's log contains no error

    Examples:
      | phase     | state               | role     | next                |
      | scoping   | scoping             | scoping  | mockup_deployment   |
      | contract  | contract            | contract | hardening_execution |
      | hardening | hardening_execution | builder  | hardening_execution |

  @to-wire
  Scenario Outline: E4 / E5. Exactly one task per role and per iteration, even if the step is replayed
    Given a creation cycle in state "<state>"
    When the launch step of task "<role>" of iteration 1 is replayed
    Then table "tasks" contains exactly one "<role>" task for iteration 1
    And task "<role>" of iteration 1 has id "<tool>-<cycle>-1-<role>"
    And the fake engine was called exactly once for "<role>"

    Examples:
      | state               | role              |
      | overlap_search      | overlap           |
      | scoping             | scoping           |
      | contract            | contract          |
      | hardening_execution | builder           |
      | hardening_execution | tests             |
      | hardening_review    | security-reviewer |
      | hardening_review    | quality-reviewer  |

  Scenario: E7. The full context is passed on after two successive scoping corrections
    Given a creation cycle in state "waiting_scoping_feedback"
    And the cycle's chat contains the requester's message "I want to track the laptops per site"
    When the requester sends scoping feedback "correction" with text "The filter per site is missing"
    And the fake engine returns a compliant report for "scoping"
    And the mock-up answers the health check after 10 seconds
    And the requester sends scoping feedback "correction" with text "The filter is there, but the CSV export is needed too"
    Then the cycle moves from "waiting_scoping_feedback" to "scoping" by "event:scoping_feedback:correction"
    And task "scoping" of iteration 3 has "I want to track the laptops per site" in its context
    And task "scoping" of iteration 3 has "The filter per site is missing" in its context
    And task "scoping" of iteration 3 has "The filter is there, but the CSV export is needed too" in its context
    And table "messages" contains 6 messages for the cycle

  Scenario: E8. The second review round receives the deviations of the first one
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    And the fake engine returns a compliant report for roles "builder"
    And the integration of the role branches succeeds
    Then task "security-reviewer" of iteration 2 receives the previous report of "security-reviewer" from iteration 1
    And task "quality-reviewer" of iteration 2 receives the previous report of "security-reviewer" from iteration 1
    And task "security-reviewer" of iteration 2 receives deviation "SEC-IDOR" on "api/tools.js"

  Scenario: E9. The same deviation reworded and moved by 3 lines is detected as stagnation
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         | line | message                                       |
      | SEC-IDOR | api/tools.js | 42   | The tool id is not checked on the server side |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule     | file         | line | message                                         |
      | SEC-IDOR | api/tools.js | 45   | Access control missing: any user reads any tool |
    And hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule     | file         | line | message                                     |
      | SEC-IDOR | api/tools.js | 48   | Insecure direct reference on /api/tools/:id |
    Then the stagnation counter of deviation "SEC-IDOR" on "api/tools.js" is 3
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "stagnation"
    And the notification sent to the admin contains "SEC-IDOR api/tools.js"

  Scenario Outline: E10. Gate "<gate>" does send its notification to the admin, named in plain words
    Given a creation cycle in state "<before>"
    When the cycle enters gate "<gate>"
    Then the fake mail server has sent the admin a message whose subject contains "Decision required — <name>"
    And the message contains the link to the cycle's dashboard

    Examples:
      | before                   | gate                  | name                               |
      | overlap_search           | gate_overlap          | A similar tool may already exist   |
      | scoping                  | gate_scoping_budget   | Scoping budget reached             |
      | scoping                  | gate_scoping_blocked  | Scoping blocked                    |
      | contract                 | gate_contract_blocked | Contract blocked                   |
      | waiting_preview_feedback | gate_2                | Gate 2: go to production           |
      | waiting_ci               | gate_delivery_blocked | Delivery blocked                   |
      | prod_deployment          | gate_prod_blocked     | Production deployment failed       |
      | scoping                  | gate_incident         | Technical incident                 |

    # Transient departures (see E15): the notification of these gates is checked by scenarios 34 and E1/E9.
    @to-wire
    Examples:
      | before               | gate                   | name                                |
      | hardening_evaluation | gate_hardening_blocked | Hardening blocked                   |
      | candidate_image      | gate_1                 | Gate 1: name and domain of the tool |

  Scenario: E10 bis. The orchestrator refuses to start if a mandatory configuration is missing
    Given a configuration without variable "ADMIN_ESCALATION_ADDRESS"
    When the orchestrator starts
    Then the orchestrator stops with message "ADMIN_ESCALATION_ADDRESS missing"
    And no workflow is launched

  @to-wire
  Scenario: E11. The scoping container receives the platform ↔ tool execution contract
    Given a creation cycle in state "scoping"
    When the fake engine returns a compliant report for "scoping"
    Then the tool's mock-up container receives variable "PORT"
    And the tool's mock-up container receives variable "APP_URL" equal to "https://inventory.scoping.example.test"
    And the tool's mock-up container receives variable "NODE_ENV"
    And the variables received by the mock-up container are exactly the ones listed in the template's README

  @to-wire
  Scenario: E14. A fix of the orchestrator applies to the cycles in progress (DBOS patching, constant version), without an incident
    Given a creation cycle in state "hardening_execution"
    When the orchestrator is restarted with fixed code
    Then the cycle's workflow is still running
    And the cycle is in state "hardening_execution"
    And the cycle has not passed through state "gate_incident"

  @t:<state>--cancellation-->end_cancellation
  Scenario Outline: E15. Cancelling a tool from state "<state>" stops its container and leaves a consistent state
    Given a creation cycle in state "<state>"
    And an agent task of the cycle running if the state launches one
    When the admin cancels the cycle
    Then the cycle moves from "<state>" to "end_cancellation" by "cancellation"
    And no agent container of the cycle is running
    And every still open task of the cycle has status "failed", a cost equal to its role's budget cap if it had started and 0 $ otherwise
    And table "tool_history" contains a cancellation by actor "admin@example.test"
    And the requester receives an end-of-cycle notification
    And the tool is archived
    And no data of the cycle is deleted

    Examples:
      | state                    |
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
      | gate_hardening_blocked   |
      | merge                    |
      | waiting_ci               |
      | gate_1                   |
      | preview_deployment       |
      | waiting_preview_feedback |
      | preview_pipeline         |
      | gate_2                   |
      | prod_deployment          |
      | gate_delivery_blocked    |
      | gate_prod_blocked        |
      | gate_incident            |

  # Transient states (the workflow leaves them by itself, without waiting for anyone): the cycle is held there while
  # the admin cancels; the cancellation, also posted on its own topic, is seen at the start of the state's processing.
  @t:<state>--cancellation-->end_cancellation
  Scenario Outline: E15 bis. Cancelling a tool from transient state "<state>" ends it from that state
    Given a creation cycle held in state "<state>"
    When the admin cancels the cycle
    Then the cycle moves from "<state>" to "end_cancellation" by "cancellation"
    And no agent container of the cycle is running
    And table "tool_history" contains a cancellation by actor "admin@example.test"
    And the requester receives an end-of-cycle notification
    And the tool is archived

    Examples:
      | state                |
      | request_received     |
      | hardening_evaluation |
      | candidate_image      |
