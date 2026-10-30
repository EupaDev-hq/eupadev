# Scenarios 1 to 10 of docs/orchestrator-scenarios.md — entry of the cycle and overlap search.
# Tag @t:<from>--<trigger>--><to> = transition of src/machine/states.ts covered (tests/feature-coverage.test.ts).
# Tag @to-wire = scenario without Cucumber step definitions for now (excluded from `pnpm test:bdd`, counted by tests/feature-coverage.test.ts).
Feature: Entry and overlap search
  A creation request goes through the overlap search and then the repository creation;
  an evolution request skips both. The search is cautious: any doubt goes up to the admin.

  Background:
    Given the default thresholds
    And the fake agent engine

  @t:request_received--guard:creation-->overlap_search
  @t:overlap_search--guard:not_plausible-->repo_creation
  @t:repo_creation--task:done-->scoping
  Scenario: 1. A creation request starts an overlap search before any scoping
    Given a creation cycle in state "request_received"
    When the request is handled
    Then the cycle moves from "request_received" to "overlap_search" by "guard:creation"
    And table "tasks" contains exactly one "overlap" task for iteration 1
    And table "tasks" contains no "scoping" task
    When the fake engine returns verdict "not_plausible" for "overlap"
    Then the cycle moves from "overlap_search" to "repo_creation" by "guard:not_plausible"
    When the forge creates repository "inventory"
    Then the cycle moves from "repo_creation" to "scoping" by "task:done"
    And table "tasks" contains exactly one "scoping" task for iteration 1

  @t:overlap_search--guard:plausible-->gate_overlap
  @t:gate_overlap--gate:approved-->repo_creation
  Scenario: 2. A plausible overlap with a tool of the catalogue opens the admin gate with the agent's reason
    Given an existing tool "car-fleet" approved at Gate 1 with comment "Booking of the service vehicles"
    And a creation cycle in state "overlap_search"
    When the fake engine returns verdict "plausible" for "overlap" on tool "car-fleet" with reason "Tool 'car-fleet' already handles vehicle bookings"
    Then the cycle moves from "overlap_search" to "gate_overlap" by "guard:plausible"
    And the notification sent to the admin contains "Tool 'car-fleet' already handles vehicle bookings"
    And the notification sent to the admin contains "car-fleet"
    When the admin decides "approved" at gate "gate_overlap"
    Then the cycle moves from "gate_overlap" to "repo_creation" by "gate:approved"

  Scenario: 2 bis. The overlap task receives the catalogue of the existing tools as data, never in its instructions
    Given an existing tool "car-fleet" approved at Gate 1 with comment "Booking of the service vehicles"
    And a creation cycle in state "overlap_search"
    Then task "overlap" of iteration 1 has "car-fleet" in its context
    And task "overlap" of iteration 1 has "Booking of the service vehicles" in its context
    And task "overlap" of iteration 1 does not receive "Booking of the service vehicles" in its instructions
    And task "overlap" of iteration 1 does not receive "car-fleet" in its instructions

  @t:overlap_search--guard:unreadable_report-->gate_overlap
  Scenario: 2 ter. A plausible verdict that names a tool missing from the catalogue is "to be checked", never "not plausible"
    Given a creation cycle in state "overlap_search"
    When the fake engine returns verdict "plausible" for "overlap" on tool "made-up-tool" with reason "A tool already covers this need"
    Then the cycle moves from "overlap_search" to "gate_overlap" by "guard:unreadable_report"
    And the notification sent to the admin contains "is not in the catalogue"
    And the notification sent to the admin contains "made-up-tool"
    And the cycle is not in state "repo_creation"

  @t:overlap_search--task:failed-->gate_overlap
  Scenario: 3. An overlap search that fails technically opens the admin gate out of caution
    Given a creation cycle in state "overlap_search"
    When the fake engine returns a failure for "overlap" with reason "registry unreachable"
    Then the cycle moves from "overlap_search" to "gate_overlap" by "task:failed"
    And the notification sent to the admin contains "registry unreachable"
    And the cycle is not in state "repo_creation"

  @t:overlap_search--guard:unreadable_report-->gate_overlap
  Scenario: 4. An unreadable overlap report is treated as "to be checked", not as "not plausible"
    Given a creation cycle in state "overlap_search"
    When the fake engine returns a report invalid against the schema for "overlap"
    Then task "overlap" of iteration 1 has status "failed"
    And the cycle moves from "overlap_search" to "gate_overlap" by "guard:unreadable_report"
    And the notification sent to the admin contains "invalid report"
    And the notification sent to the admin contains "to be checked"
    And the cycle is not in state "repo_creation"

  @t:overlap_search--guard:unreadable_report-->gate_overlap
  Scenario: 4 bis. The verdict is a field of the report: a valid report without a verdict is "to be checked", even if its summary starts with "not_plausible"
    Given a creation cycle in state "overlap_search"
    When the fake engine returns for "overlap" a report without verdict whose summary starts with "not_plausible"
    Then task "overlap" of iteration 1 has status "done"
    And the cycle moves from "overlap_search" to "gate_overlap" by "guard:unreadable_report"
    And the notification sent to the admin contains "without a verdict"
    And the cycle is not in state "repo_creation"

  @t:gate_overlap--gate:refused-->end_refusal
  Scenario: 5. A refusal at the overlap gate ends the cycle and notifies the requester
    Given a creation cycle in state "gate_overlap"
    When the admin decides "refused" at gate "gate_overlap"
    Then the cycle moves from "gate_overlap" to "end_refusal" by "gate:refused"
    And the requester receives an end-of-cycle notification
    And the tool is archived
    And no data of the cycle is deleted

  @t:gate_overlap--gate:correction-->repo_creation
  Scenario: 6. A correction by the admin at the overlap gate is passed on to the first scoping
    Given a creation cycle in state "gate_overlap"
    When the admin decides "correction" at gate "gate_overlap" with text "Keep to the utility vehicles, car-fleet covers the rest"
    Then the cycle moves from "gate_overlap" to "repo_creation" by "gate:correction"
    When the forge creates repository "inventory"
    Then the cycle moves from "repo_creation" to "scoping" by "task:done"
    And task "scoping" of iteration 1 receives the clarification "Keep to the utility vehicles, car-fleet covers the rest" as data
    And task "scoping" of iteration 1 does not receive this clarification in its instructions

  @t:request_received--guard:evolution-->scoping
  Scenario: 7. An evolution request skips the overlap search and the repository creation
    Given an evolution cycle in state "request_received"
    When the request is handled
    Then the cycle moves from "request_received" to "scoping" by "guard:evolution"
    And table "tasks" contains no "overlap" task
    And the forge has received no repository creation request

  # Decision A (2026-10-27, ADR-023): at the start of an evolution, the PLATFORM moves the tool to the latest published
  # core version, before any agent (agents have no route to the forge's registry). Never a dead end.
  Scenario: 7 bis. At the start of an evolution, the platform moves the tool to the latest published version of the core before any agent
    Given the latest published core version "0.1.2" while the tool is on "0.1.1"
    And an evolution cycle in state "request_received"
    When the request is handled
    Then the cycle moves from "request_received" to "scoping" by "guard:evolution"
    And the forge has published the "core" work into main before task "scoping" of iteration 1
    And the requester reads the orchestrator's message "Core updated: 0.1.1 → 0.1.2" in the chat

  Scenario: 7 ter. An unreachable core registry does not stop the evolution: the cycle continues on the current version, the requester and the admin are notified
    Given an unreachable core registry
    And an evolution cycle in state "request_received"
    When the request is handled
    Then the cycle moves from "request_received" to "scoping" by "guard:evolution"
    And the requester reads the orchestrator's message "Core not updated (core registry unreachable): the cycle goes on with the current core version." in the chat
    And the notification sent to the admin contains "Core not updated"
    And the platform has checked the core once without publishing anything into main

  Scenario: 7 quater. A tool already on the latest version of the core receives no commit; a creation never checks the core
    Given an evolution cycle in state "request_received"
    When the request is handled
    Then the cycle moves from "request_received" to "scoping" by "guard:evolution"
    And the platform has checked the core once without publishing anything into main

  Scenario: 8. An evolution request does not ask for Gate 1 again
    Given an evolution cycle in state "waiting_ci"
    When the forge signals "ci_finished" with result "green" and digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    Then the cycle moves from "waiting_ci" to "candidate_image" by "event:ci_finished:green"
    And the cycle moves from "candidate_image" to "preview_deployment" by "guard:gate1_already_granted"
    And no gate "gate_1" notification is sent to the admin

  Scenario: 9. An evolution request starts with a cycle budget at zero
    Given a tool in production whose creation cycle cost 18 $
    And an evolution cycle in state "request_received" for this tool
    When the request is handled
    Then the cycle's scoping budget check is on 0 $ spent for a cap of 10 $
    And the cycle's scoping budget cap is 10 $
    And the cycle's hardening budget cap is 40 $

  @to-wire
  Scenario: 10. The repository of a new tool is created only once, even if the step is replayed
    Given a creation cycle in state "repo_creation"
    When the forge creates repository "inventory"
    And step "repo_creation" is replayed
    Then the forge has received exactly one creation request for repository "inventory"
    And the cycle is in state "scoping"
