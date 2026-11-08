# Scenarios 11 to 22 of docs/orchestrator-scenarios.md — scoping loop, mock-up, requester's feedback, pause, contract.
# Tag @t:<from>--<trigger>--><to> = transition of src/machine/states.ts covered (tests/feature-coverage.test.ts).
# Tag @to-wire = scenario without Cucumber step definitions for now (excluded from `pnpm test:bdd`, counted by tests/feature-coverage.test.ts).
Feature: Scoping
  The scoping loop produces a mock-up that the requester judges in the chat. Its guard-rails:
  budget 10 $, same error 3 times, 5 attempts, 4 h of agent work. The silent requester is
  reminded at 24, 48 and 72 h, paused at 96 h, archived after 30 days of pause.

  Background:
    Given the default thresholds
    And the fake agent engine

  @t:waiting_scoping_feedback--event:scoping_feedback:correction-->scoping
  Scenario: 11. A "not satisfied" requester restarts a scoping whose context holds the whole chat history
    Given a creation cycle in state "waiting_scoping_feedback"
    And the cycle's chat contains the requester's message "I want to track the laptops per site"
    And the cycle's chat contains the orchestrator's message "Mock-up available: https://inventory.scoping.example.test"
    When the requester sends scoping feedback "correction" with text "The filter per site is missing"
    Then the cycle moves from "waiting_scoping_feedback" to "scoping" by "event:scoping_feedback:correction"
    And task "scoping" of iteration 2 has "I want to track the laptops per site" in its context
    And task "scoping" of iteration 2 has "Mock-up available: https://inventory.scoping.example.test" in its context
    And task "scoping" of iteration 2 has "The filter per site is missing" in its context
    # What the platform offers is data of the task (agents/capabilities.json of the engine image), never an instruction.
    And task "scoping" of iteration 2 has "platform_capabilities" in its context
    And task "scoping" of iteration 2 has "csv-export" in its context
    And task "scoping" of iteration 2 does not receive "csv-export" in its instructions

  @t:waiting_scoping_feedback--event:scoping_feedback:satisfied-->contract
  @t:contract--task:done-->hardening_execution
  Scenario: 11 bis. A satisfied requester starts the contract, then the first hardening round
    Given a creation cycle in state "waiting_scoping_feedback"
    When the requester sends scoping feedback "satisfied"
    Then the cycle moves from "waiting_scoping_feedback" to "contract" by "event:scoping_feedback:satisfied"
    And table "tasks" contains exactly one "contract" task for iteration 1
    # E7: the contract starts from the validated scoping — the scoping branch is published into main before the contract task is created.
    And the forge has published the "scoping" work into main before task "contract" of iteration 1
    When the fake engine returns a compliant report for "contract"
    Then the cycle moves from "contract" to "hardening_execution" by "task:done"
    # ADR-021: a round starts the acceptance suite (tests) then the single builder (builder), never backend or frontend.
    # A-R2a: explicit wait — the builder is not created as long as the tests task is not finished.
    And table "tasks" contains exactly one "tests" task for iteration 1
    And the forge has published the "contract" work into main before task "tests" of iteration 1
    And table "tasks" contains no "builder" task for iteration 1
    When the fake engine returns a compliant report for "tests"
    Then table "tasks" contains exactly one "builder" task for iteration 1
    And task "tests" of iteration 1 was created before task "builder"
    And table "tasks" contains no "backend" task for iteration 1
    And table "tasks" contains no "frontend" task for iteration 1

  @t:waiting_scoping_feedback--timeout_exceeded-->waiting_scoping_feedback
  Scenario: 12. A silent requester receives reminders at 24, 48 and 72 h; no agent is restarted
    Given a creation cycle in state "waiting_scoping_feedback"
    When 24 hours pass without an answer from the requester
    Then the cycle stays in state "waiting_scoping_feedback" by "timeout_exceeded"
    And the requester has received 1 reminder
    When 24 hours pass without an answer from the requester
    Then the requester has received 2 reminders
    When 24 hours pass without an answer from the requester
    Then the requester has received 3 reminders
    And table "tasks" contains no "scoping" task for iteration 2

  @t:waiting_scoping_feedback--guard:reminders_exhausted-->scoping_pause
  Scenario: 13. At 96 h (24 h after the 3rd reminder without an answer), the tool is paused, its mock-up container is stopped and the admin is notified
    Given a creation cycle in state "waiting_scoping_feedback"
    And the requester has already received 3 reminders
    When 24 hours pass without an answer from the requester
    Then the cycle moves from "waiting_scoping_feedback" to "scoping_pause" by "guard:reminders_exhausted"
    And the tool's mock-up container is stopped
    And the notification sent to the admin contains "paused"
    And the requester does not receive a 4th reminder

  @t:scoping_pause--event:requester_message-->mockup_deployment
  Scenario: 14. An answer from the requester resumes a paused tool where it stopped: mock-up restarted, then their message treated as a correction request
    Given a creation cycle in state "scoping_pause"
    When the requester sends message "Sorry for the silence, the filter per site is missing"
    Then the cycle moves from "scoping_pause" to "mockup_deployment" by "event:requester_message"
    And table "tasks" contains no "scoping" task for iteration 2
    When the mock-up answers the health check after 20 seconds
    Then the cycle moves from "mockup_deployment" to "waiting_scoping_feedback" by "task:done"
    And message "Sorry for the silence, the filter per site is missing" is handled as scoping feedback "correction"
    And the cycle moves from "waiting_scoping_feedback" to "scoping" by "event:scoping_feedback:correction"
    And task "scoping" of iteration 2 has "Sorry for the silence, the filter per site is missing" in its context

  @t:scoping_pause--timeout_exceeded-->end_abandonment
  Scenario: 14 bis. After 30 days of pause without an answer, the tool is archived: mock-up and subdomain removed, archiving of the repository asked of the admin, history and costs kept, no new cycle possible
    Given a creation cycle in state "scoping_pause"
    And a cumulative cycle cost of 7 $
    When 30 days pass without an answer from the requester
    Then the cycle moves from "scoping_pause" to "end_abandonment" by "timeout_exceeded"
    And the requester receives an end-of-cycle notification
    And the notification sent to the admin contains "archived"
    And the tool's mock-up container is removed
    And the tool's scoping subdomain is removed
    And the admin is asked to archive the tool's repository in the forge
    And the tool is archived
    And the cycle's cumulative cost is 7 $
    And no data of the cycle is deleted
    And creating a new cycle for this tool is refused

  @t:<state>--event:requester_abandonment-->end_abandonment
  Scenario Outline: 15. The requester can abandon their request from the chat before the merge; an abandoned creation is archived, never deleted
    Given a creation cycle in state "<state>"
    When the requester abandons from the chat
    Then the cycle moves from "<state>" to "end_abandonment" by "event:requester_abandonment"
    And the requester receives an end-of-cycle notification
    And the tool is archived
    And no data of the cycle is deleted

    Examples:
      | state                    |
      | waiting_scoping_feedback |
      | scoping_pause            |

  Scenario: 15 bis. After the merge, the requester can no longer abandon it themselves: they go through the admin, who cancels
    Given a creation cycle in state "waiting_preview_feedback"
    When the requester abandons from the chat
    Then the abandonment request is refused with message "After the merge, only the admin can cancel the cycle"
    And the cycle is in state "waiting_preview_feedback"
    And the notification sent to the admin contains "wishes to abandon"
    When the admin cancels the cycle
    Then the cycle moves from "waiting_preview_feedback" to "end_cancellation" by "cancellation"

  @t:scoping--guard:technical_failure-->scoping
  Scenario: 16. A technical failure of the scoping is restarted with the error in the context
    Given a creation cycle in state "scoping"
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    Then the cycle stays in state "scoping" by "guard:technical_failure"
    And table "tasks" contains exactly one "scoping" task for iteration 2
    And task "scoping" of iteration 2 has "npm install: ECONNRESET" in its context
    And the cycle's "same error" counter is 1

  Scenario: 16 ter. The scoping's message goes out with the mock-up link; a technical word sends the task back with the reason (A-R6, C1 and D2)
    Given a creation cycle in state "scoping"
    When the fake engine returns a compliant report for "scoping" with the message to the requester "Here is the form. Do you need a JSON export?"
    Then the cycle stays in state "scoping" by "guard:technical_failure"
    And task "scoping" of iteration 2 has "jargon shown to the requester: JSON" in its context
    When the fake engine returns a compliant report for "scoping" with the message to the requester "Here is the form. Do you need an export to a spreadsheet?"
    Then the cycle moves from "scoping" to "mockup_deployment" by "task:done"
    When the mock-up answers the health check after 1 seconds
    Then the cycle moves from "mockup_deployment" to "waiting_scoping_feedback" by "task:done"
    And the requester receives with the mock-up link the message "Do you need an export to a spreadsheet?"

  @t:repo_creation--task:failed-->gate_scoping_blocked
  @t:gate_scoping_blocked--gate:approved-->repo_creation
  Scenario: 16 bis. A failure of the repository creation opens the gate "scoping blocked"; "continue" goes through the creation again, which does nothing if the repository exists
    Given a creation cycle in state "repo_creation"
    When the forge refuses to create the repository with error "HTTP 500: storage full"
    Then the cycle moves from "repo_creation" to "gate_scoping_blocked" by "task:failed"
    And the notification sent to the admin contains "HTTP 500: storage full"
    When the admin decides "approved" at gate "gate_scoping_blocked"
    Then the cycle moves from "gate_scoping_blocked" to "repo_creation" by "gate:approved"
    When the forge creates repository "inventory"
    Then the cycle moves from "repo_creation" to "scoping" by "task:done"
    And table "tasks" contains exactly one "scoping" task for iteration 1

  @t:scoping--guard:escalation-->gate_scoping_blocked
  Scenario: 17. Three identical consecutive technical failures open the gate "scoping blocked"
    Given a creation cycle in state "scoping"
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    Then the cycle stays in state "scoping" by "guard:technical_failure"
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    Then the cycle stays in state "scoping" by "guard:technical_failure"
    And the cycle's "same error" counter is 2
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    Then the cycle moves from "scoping" to "gate_scoping_blocked" by "guard:escalation"
    And the notification sent to the admin contains "stagnation"
    And the notification sent to the admin contains "npm install: ECONNRESET"
    And table "tasks" contains no "scoping" task for iteration 4

  Scenario: 18. A different technical failure resets the repetition counter to one; the 5th attempt in total escalates
    Given a creation cycle in state "scoping"
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    And the fake engine returns a failure for "scoping" with reason "docker build: no space left on device"
    Then the cycle's "same error" counter is 1
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    Then the cycle's "same error" counter is 1
    And the cycle is in state "scoping"
    When the fake engine returns a failure for "scoping" with reason "docker build: no space left on device"
    Then the cycle is in state "scoping"
    And the cycle's attempt counter is 4
    And table "tasks" contains exactly one "scoping" task for iteration 5
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    Then the cycle's attempt counter is 5
    And the cycle moves from "scoping" to "gate_scoping_blocked" by "guard:escalation"
    And the notification sent to the admin contains "attempts cap"
    And table "tasks" contains no "scoping" task for iteration 6

  @t:scoping--guard:escalation-->gate_scoping_blocked
  @t:gate_scoping_blocked--gate:approved-->repo_creation
  Scenario: 19. "Continue" resets the counters to zero but not the cost spent
    Given a creation cycle in state "scoping"
    When the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    And the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    And the fake engine returns a failure for "scoping" with reason "npm install: ECONNRESET"
    Then the cycle moves from "scoping" to "gate_scoping_blocked" by "guard:escalation"
    And the cycle's "same error" counter is 3
    And the cycle's attempt counter is 3
    Given a cumulative cycle cost of 6 $
    When the admin decides "approved" at gate "gate_scoping_blocked"
    Then the cycle moves from "gate_scoping_blocked" to "repo_creation" by "gate:approved"
    And the cycle's "same error" counter is 0
    And the cycle's attempt counter is 0
    And the cycle's cumulative cost is 6 $

  @t:scoping--guard:budget_exceeded-->gate_scoping_budget
  @t:gate_scoping_budget--gate:approved-->scoping
  Scenario: 20. A top-up from the admin ("approve" + amount) raises the cap of the cycle and is traced
    Given a creation cycle in state "waiting_scoping_feedback"
    And a cumulative cycle cost of 10 $
    When the requester sends scoping feedback "correction" with text "The filter per site is missing"
    Then the cycle moves from "waiting_scoping_feedback" to "scoping" by "event:scoping_feedback:correction"
    And the cycle moves from "scoping" to "gate_scoping_budget" by "guard:budget_exceeded"
    And table "tasks" contains no "scoping" task for iteration 2
    When the admin decides "approved" at gate "gate_scoping_budget" with a top-up of 5 $
    Then the cycle moves from "gate_scoping_budget" to "scoping" by "gate:approved"
    And the cycle's scoping budget cap is 15 $
    And table "approvals" contains a "approved" decision for gate "gate_scoping_budget" with a top-up of 5 $
    And table "tasks" contains exactly one "scoping" task for iteration 2

  Scenario: 20 bis. "Continue" without a top-up when the budget is what blocks immediately triggers the same gate again
    Given a creation cycle in state "gate_scoping_budget"
    And a cumulative cycle cost of 10 $
    When the admin decides "approved" at gate "gate_scoping_budget"
    Then the cycle moves from "gate_scoping_budget" to "scoping" by "gate:approved"
    And the cycle moves from "scoping" to "gate_scoping_budget" by "guard:budget_exceeded"
    And table "tasks" contains no "scoping" task for iteration 2
    And the notification sent to the admin contains "budget"

  @t:contract--task:failed-->gate_contract_blocked
  @t:contract--guard:budget_exceeded-->gate_contract_blocked
  @t:gate_contract_blocked--gate:approved-->contract
  Scenario: 20 ter. A contract that fails technically or is over budget opens the gate "contract blocked", whose "continue" restarts the contract
    Given a creation cycle in state "contract"
    When the fake engine returns a failure for "contract" with reason "invalid openapi: paths missing"
    Then the cycle moves from "contract" to "gate_contract_blocked" by "task:failed"
    And the notification sent to the admin contains "invalid openapi: paths missing"
    When the admin decides "approved" at gate "gate_contract_blocked"
    Then the cycle moves from "gate_contract_blocked" to "contract" by "gate:approved"
    And table "tasks" contains exactly one "contract" task for iteration 2
    And table "tasks" contains no "scoping" task for iteration 2
    Given a cumulative cycle cost of 40 $
    When the fake engine returns a failure for "contract" with reason "invalid openapi: paths missing"
    And the admin decides "approved" at gate "gate_contract_blocked"
    Then the cycle moves from "contract" to "gate_contract_blocked" by "guard:budget_exceeded"
    And table "tasks" contains no "contract" task for iteration 3
    And the budget cap applied to the contract is the cycle's hardening cap, 40 $

  @t:scoping--task:done-->mockup_deployment
  @t:mockup_deployment--task:done-->waiting_scoping_feedback
  Scenario: 21. The mock-up container waits for its availability up to the configured delay before announcing the link
    Given a creation cycle in state "scoping"
    When the fake engine returns a compliant report for "scoping"
    Then the cycle moves from "scoping" to "mockup_deployment" by "task:done"
    And the requester has received no link to the mock-up
    When the mock-up answers the health check after 45 seconds
    Then the cycle moves from "mockup_deployment" to "waiting_scoping_feedback" by "task:done"
    And table "deployments" contains a "mockup" deployment with health "ok"
    And the requester receives link "https://inventory.scoping.example.test"

  @t:mockup_deployment--guard:technical_failure-->scoping
  @t:mockup_deployment--guard:escalation-->gate_scoping_blocked
  Scenario: 21 bis. A mock-up that does not answer within the delay restarts the scoping with the error; three times in a row, the admin decides
    Given a creation cycle in state "mockup_deployment"
    When the mock-up does not answer the health check for 60 seconds
    Then the cycle moves from "mockup_deployment" to "scoping" by "guard:technical_failure"
    And table "deployments" contains a "mockup" deployment with health "failed"
    And task "scoping" of iteration 2 has "health check failed after 60 s" in its context
    And the cycle's "same error" counter is 1
    And the cycle's attempt counter is 1
    When the fake engine returns a compliant report for "scoping"
    And the mock-up does not answer the health check for 60 seconds
    And the fake engine returns a compliant report for "scoping"
    And the mock-up does not answer the health check for 60 seconds
    Then the cycle moves from "mockup_deployment" to "gate_scoping_blocked" by "guard:escalation"
    And the notification sent to the admin contains "health check failed after 60 s"

  @to-wire
  Scenario: 22. Two tools in scoping at the same time each have their own container and subdomain
    Given a creation cycle in state "scoping" for tool "inventory"
    And a creation cycle in state "scoping" for tool "car-fleet"
    When the fake engine returns a compliant report for "scoping" for each tool
    And the mock-up of each tool answers the health check after 10 seconds
    Then the mock-up container of tool "inventory" and the one of tool "car-fleet" have different names
    And the requester of tool "inventory" receives link "https://inventory.scoping.example.test"
    And the requester of tool "car-fleet" receives link "https://car-fleet.scoping.example.test"
    And the execution contract of each container contains "APP_URL" equal to its own link
