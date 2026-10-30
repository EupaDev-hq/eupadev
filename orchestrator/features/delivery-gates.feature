# Scenarios 34 to 41 of docs/orchestrator-scenarios.md — Gate 1, Preview, Preview pipeline, Gate 2, Prod,
# and the rules common to all the gates (correction, refusal, reminders, cancellation).
# Tag @t:<from>--<trigger>--><to> = transition of src/machine/states.ts covered (tests/feature-coverage.test.ts).
# Tag @to-wire = scenario without Cucumber step definitions for now (excluded from `pnpm test:bdd`, counted by tests/feature-coverage.test.ts).
Feature: Gates and delivery
  After the merge, no more going back to scoping: Gate 1 (once per tool), the Preview pipeline
  (green checks before the requester is notified), the Preview judged by the requester, Gate 2 on
  a precise digest, the Prod.
  Every admin gate handles approve / correction / refuse and reminds the admin at 24, 48, 72 h.

  Background:
    Given the default thresholds
    And the fake agent engine

  @t:waiting_ci--event:ci_finished:green-->candidate_image
  @t:candidate_image--guard:gate1_required-->gate_1
  @t:gate_1--gate:approved-->preview_deployment
  @t:preview_deployment--task:done-->preview_pipeline
  @t:preview_pipeline--event:preview_pipeline_finished:green-->waiting_preview_feedback
  @t:candidate_image--guard:gate1_already_granted-->preview_deployment
  Scenario: 34. Gate 1 is asked only once, not at the second Preview of the same tool
    Given a creation cycle in state "waiting_ci"
    When the forge signals "ci_finished" with result "green" and digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    Then the cycle moves from "waiting_ci" to "candidate_image" by "event:ci_finished:green"
    And the cycle moves from "candidate_image" to "gate_1" by "guard:gate1_required"
    And the notification sent to the admin contains "inventory.example.test"
    When the admin decides "approved" at gate "gate_1"
    Then the cycle moves from "gate_1" to "preview_deployment" by "gate:approved"
    And table "approvals" contains a "approved" decision for gate "gate_1"
    When the Preview answers the health check after 30 seconds
    Then the cycle moves from "preview_deployment" to "preview_pipeline" by "task:done"
    And table "deployments" contains a "preview" deployment of digest "sha256:1111111111111111111111111111111111111111111111111111111111111111" with health "ok"
    And the requester has received no link to the Preview
    When the forge signals "preview_pipeline_finished" with result "green"
    Then the cycle moves from "preview_pipeline" to "waiting_preview_feedback" by "event:preview_pipeline_finished:green"
    And the requester receives link "https://inventory.preview.example.test"
    When the requester sends preview feedback "bug" with text "The sorting per site does not work"
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule | file |
    And the forge accepts the squash into "main"
    And the forge signals "ci_finished" with result "green" and digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    Then the cycle moves from "candidate_image" to "preview_deployment" by "guard:gate1_already_granted"
    And table "approvals" contains exactly one decision for gate "gate_1"

  @t:gate_1--gate:correction-->hardening_execution
  @t:gate_1--gate:scope_change-->contract
  Scenario: 34 bis. At Gate 1, a "correction" from the admin goes back to hardening (contract unchanged); a "scope change" goes back to the contract; never to scoping
    Given a creation cycle in state "gate_1"
    When the admin decides "correction" at gate "gate_1" with text "Rename to 'it-fleet'"
    Then the cycle moves from "gate_1" to "hardening_execution" by "gate:correction"
    And task "builder" of iteration 2 has "Rename to 'it-fleet'" in its context
    And table "tasks" contains no "contract" task for iteration 2
    And table "tasks" contains no "scoping" task for iteration 2
    Given a creation cycle in state "gate_1" for tool "car-fleet"
    When the admin decides "scope_change" at gate "gate_1" with text "Add the management of the vehicle keys"
    Then the cycle moves from "gate_1" to "contract" by "gate:scope_change"
    And task "contract" of iteration 2 has "Add the management of the vehicle keys" in its context
    And table "tasks" contains no "scoping" task for iteration 2

  Scenario: 34 ter. A "scope change" without a comment is refused on entry: the admin says what changes
    Given a creation cycle in state "gate_1"
    When the admin tries to decide "scope_change" at gate "gate_1" without a comment
    Then the decision is refused with message "comment required for scope_change"
    And the cycle is in state "gate_1"
    And table "approvals" contains no decision for gate "gate_1"

  Scenario: 34 quater. A CI announced green with a red check is refused on entry: the image is never a candidate
    Given a creation cycle in state "waiting_ci"
    When the forge tries to signal a green CI with digest "sha256:4444444444444444444444444444444444444444444444444444444444444444" and red check "tests"
    Then the forge's signal is refused with message "outcome green with 1 red check(s)"
    And the cycle is in state "waiting_ci"
    And the cycle has not passed through state "candidate_image"

  @t:waiting_preview_feedback--event:preview_feedback:bug-->hardening_execution
  Scenario: 35. A "bug" correction chosen by the requester at the Preview goes back to hardening, never to scoping
    Given a creation cycle in state "waiting_preview_feedback"
    When the requester sends preview feedback "bug" with text "The sorting per site does not work"
    Then the cycle moves from "waiting_preview_feedback" to "hardening_execution" by "event:preview_feedback:bug"
    And task "builder" of iteration 2 has "The sorting per site does not work" in its context
    And table "tasks" contains no "scoping" task for iteration 2
    And table "tasks" contains no "contract" task for iteration 2

  @t:waiting_preview_feedback--event:preview_feedback:new_capability-->contract
  Scenario: 36. A "new capability" correction chosen by the requester at the Preview goes back to the contract
    Given a creation cycle in state "waiting_preview_feedback"
    When the requester sends preview feedback "new_capability" with text "The inventory should be exportable as CSV"
    Then the cycle moves from "waiting_preview_feedback" to "contract" by "event:preview_feedback:new_capability"
    And task "contract" of iteration 2 has "The inventory should be exportable as CSV" in its context
    And table "tasks" contains no "scoping" task for iteration 2

  @t:preview_pipeline--event:preview_pipeline_finished:red-->hardening_execution
  @t:preview_pipeline--event:preview_pipeline_finished:green-->waiting_preview_feedback
  @t:waiting_preview_feedback--event:preview_feedback:satisfied-->gate_2
  Scenario: 36 bis. A red Preview pipeline automatically sends back to hardening with the failed checks, without disturbing the requester; a green pipeline sends them the link, and their agreement opens Gate 2 without restarting the pipeline
    Given a creation cycle in state "preview_pipeline" with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111" in Preview
    And the requester has received no link to the Preview
    When the forge signals "preview_pipeline_finished" with result "red" and the failed checks:
      | check         | result |
      | dast          | red    |
      | accessibility | green  |
    Then the cycle moves from "preview_pipeline" to "hardening_execution" by "event:preview_pipeline_finished:red"
    And the cycle has not passed through state "gate_hardening_blocked"
    And the cycle has not passed through state "waiting_preview_feedback"
    And the requester has received no link to the Preview
    And table "pipeline_results" contains for pipeline "preview" and iteration 1 check "dast" with result "red" against digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    And task "builder" of iteration 2 has "preview:dast" in its context
    And the cycle's round counter is 2
    Given a creation cycle in state "preview_pipeline" for tool "car-fleet" with digest "sha256:3333333333333333333333333333333333333333333333333333333333333333" in Preview
    When the forge signals "preview_pipeline_finished" with result "green"
    Then the cycle moves from "preview_pipeline" to "waiting_preview_feedback" by "event:preview_pipeline_finished:green"
    And the requester receives link "https://car-fleet.preview.example.test"
    When the requester sends preview feedback "satisfied"
    Then the cycle moves from "waiting_preview_feedback" to "gate_2" by "event:preview_feedback:satisfied"
    And the notification sent to the admin contains "sha256:3333333333333333333333333333333333333333333333333333333333333333"
    And the notification sent to the admin contains "dast: green"

  @t:hardening_execution--guard:escalation-->gate_hardening_blocked
  Scenario: 36 ter. A red Preview pipeline that comes back round after round escalates to the admin through the hardening guard-rails, and the admin sees which check fails, its result and for how many rounds
    Given a creation cycle in state "preview_pipeline" with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111" in Preview
    Then the cycle's round counter is 1
    When the forge signals "preview_pipeline_finished" with result "red" and the failed checks:
      | check | result |
      | dast  | red    |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule | file |
    And the delivery up to the Preview pipeline replays with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    And the forge signals "preview_pipeline_finished" with result "red" and the failed checks:
      | check | result |
      | dast  | red    |
    And hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule | file |
    And the delivery up to the Preview pipeline replays with digest "sha256:4444444444444444444444444444444444444444444444444444444444444444"
    And the forge signals "preview_pipeline_finished" with result "red" and the failed checks:
      | check | result |
      | dast  | red    |
    Then the stagnation counter of deviation "preview:dast" on "pipeline" is 3
    And the cycle moves from "preview_pipeline" to "hardening_execution" by "event:preview_pipeline_finished:red"
    And the cycle moves from "hardening_execution" to "gate_hardening_blocked" by "guard:escalation"
    And table "tasks" contains no task for iteration 4
    And the notification sent to the admin contains "stagnation"
    And the notification sent to the admin contains "preview:dast"
    And the notification sent to the admin contains "red for 3 rounds"
    And the notification sent to the admin does not contain "deviation preview:dast pipeline present for"

  @t:preview_deployment--task:failed-->gate_delivery_blocked
  Scenario: 36 quater. A failed Preview deployment opens the gate "delivery blocked"
    Given a creation cycle in state "preview_deployment"
    When the Preview does not answer the health check for 60 seconds
    Then the cycle moves from "preview_deployment" to "gate_delivery_blocked" by "task:failed"
    And table "deployments" contains a "preview" deployment with health "failed"

  @t:prod_deployment--task:failed-->gate_prod_blocked
  @t:gate_prod_blocked--gate:approved-->prod_deployment
  Scenario: 36 quinquies. A failed Prod deployment opens the gate "prod blocked"; the last healthy prod deployment stays the reference; "retry" restarts only the Prod deployment of the same approved digest
    Given a tool in production with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    And an evolution cycle in state "prod_deployment" for this tool with approved digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    When the Prod does not answer the health check for 60 seconds
    Then the cycle moves from "prod_deployment" to "gate_prod_blocked" by "task:failed"
    And table "deployments" contains a "prod" deployment of digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" with health "failed"
    And the tool's last healthy "prod" deployment has digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    And the tool answers in production with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    When the admin decides "approved" at gate "gate_prod_blocked"
    Then the cycle moves from "gate_prod_blocked" to "prod_deployment" by "gate:approved"
    And the cycle has not passed through state "merge"
    And table "tasks" contains no task for iteration 2
    And the forge has received no new CI or Preview pipeline request
    And table "approvals" contains exactly one decision for gate "gate_2"
    When the Prod answers the health check after 30 seconds
    Then the cycle moves from "prod_deployment" to "end_success" by "task:done"
    And the tool answers in production with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"

  @to-wire
  Scenario: 37. Gate 2 shows the digest, the results of the Preview pipeline and the new dependencies
    Given a tool in production with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111" and dependency "pg@8.23.1"
    And an evolution cycle in state "waiting_preview_feedback" for this tool with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" in Preview
    And the SBOM of digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" contains dependencies "pg@8.23.1, zod@4.1.0"
    When the requester sends preview feedback "satisfied"
    Then the cycle moves from "waiting_preview_feedback" to "gate_2" by "event:preview_feedback:satisfied"
    And the notification sent to the admin contains "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    And the notification sent to the admin contains "dast: green"
    And the notification sent to the admin contains "new dependency: zod@4.1.0"
    And the notification sent to the admin does not contain "new dependency: pg@8.23.1"

  @t:gate_2--gate:approved-->prod_deployment
  @t:prod_deployment--task:done-->end_success
  Scenario: 38. An approved Gate 2 deploys to production exactly the approved digest, which can only be the candidate digest
    Given a creation cycle in state "gate_2" with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" in Preview
    When the admin tries to approve gate "gate_2" for digest "sha256:9999999999999999999999999999999999999999999999999999999999999999"
    Then the decision is refused with message "the candidate digest of Gate 2 is sha256:2222222222222222222222222222222222222222222222222222222222222222"
    And the cycle is in state "gate_2"
    And table "approvals" contains no decision for gate "gate_2"
    When the admin tries to approve gate "gate_2" without citing a digest
    Then the decision is refused with message "the approved digest must be cited"
    And the cycle is in state "gate_2"
    And table "approvals" contains no decision for gate "gate_2"
    When the admin decides "approved" at gate "gate_2" for digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    Then the cycle moves from "gate_2" to "prod_deployment" by "gate:approved"
    And table "approvals" contains a "approved" decision for gate "gate_2" with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    When the Prod answers the health check after 30 seconds
    Then the cycle moves from "prod_deployment" to "end_success" by "task:done"
    And table "deployments" contains a "prod" deployment of digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" with health "ok"
    And the tool answers in production with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    And the requester receives an end-of-cycle notification
    And the tool's mock-up container is removed
    And the tool's scoping subdomain is removed
    And no data of the cycle is deleted

  @t:gate_prod_blocked--gate:correction-->hardening_execution
  @t:prod_deployment--task:done-->end_success
  Scenario: 38 bis. Two Gate 2 approvals in the same cycle: the Prod deploys the most recent one, the one that was cited
    Given a creation cycle in state "gate_2" with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" in Preview
    When the admin decides "approved" at gate "gate_2" for digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    And the Prod does not answer the health check for 60 seconds
    Then the cycle moves from "prod_deployment" to "gate_prod_blocked" by "task:failed"
    When the admin decides "correction" at gate "gate_prod_blocked" with text "The database migration fails in Prod"
    Then the cycle moves from "gate_prod_blocked" to "hardening_execution" by "gate:correction"
    When the delivery up to the Preview pipeline replays with digest "sha256:3333333333333333333333333333333333333333333333333333333333333333"
    And the forge signals "preview_pipeline_finished" with result "green"
    Then the cycle moves from "preview_pipeline" to "waiting_preview_feedback" by "event:preview_pipeline_finished:green"
    When the requester sends preview feedback "satisfied"
    Then the cycle moves from "waiting_preview_feedback" to "gate_2" by "event:preview_feedback:satisfied"
    When the admin decides "approved" at gate "gate_2" for digest "sha256:3333333333333333333333333333333333333333333333333333333333333333"
    And the Prod answers the health check after 30 seconds
    Then the cycle moves from "prod_deployment" to "end_success" by "task:done"
    And table "deployments" contains a "prod" deployment of digest "sha256:3333333333333333333333333333333333333333333333333333333333333333" with health "ok"
    And the tool answers in production with digest "sha256:3333333333333333333333333333333333333333333333333333333333333333"

  @t:gate_prod_blocked--gate:approved-->prod_deployment
  @t:prod_deployment--task:done-->end_success
  Scenario: 38 ter. The Prod deploys the digest read in the approvals, never the candidate digest of the moment: a healthy Preview recorded after the approval does not go to Prod
    Given a creation cycle in state "gate_2" with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" in Preview
    When the admin decides "approved" at gate "gate_2" for digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    And the Prod does not answer the health check for 60 seconds
    Then the cycle moves from "prod_deployment" to "gate_prod_blocked" by "task:failed"
    When a healthy Preview deployment of digest "sha256:3333333333333333333333333333333333333333333333333333333333333333" is recorded in the cycle after the approval
    And the admin decides "approved" at gate "gate_prod_blocked"
    And the Prod answers the health check after 30 seconds
    Then the cycle moves from "prod_deployment" to "end_success" by "task:done"
    And table "deployments" contains a "prod" deployment of digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" with health "ok"
    And the tool answers in production with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222"

  @t:gate_2--gate:correction-->hardening_execution
  Scenario: 39. A correction from the admin at Gate 2 goes back to hardening with its text
    Given a creation cycle in state "gate_2" with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" in Preview
    When the admin decides "correction" at gate "gate_2" with text "The CSP headers are missing on /api"
    Then the cycle moves from "gate_2" to "hardening_execution" by "gate:correction"
    And task "builder" of iteration 2 has "The CSP headers are missing on /api" in its context
    And table "approvals" contains a "correction" decision for gate "gate_2" with comment "The CSP headers are missing on /api"

  @t:gate_2--gate:refused-->end_refusal
  Scenario: 40. A refusal at Gate 2 ends the cycle, notifies the requester and cleans up the resources; a refused creation is archived, a refused evolution leaves the tool in prod intact
    Given a creation cycle in state "gate_2" with digest "sha256:2222222222222222222222222222222222222222222222222222222222222222" in Preview
    When the admin decides "refused" at gate "gate_2"
    Then the cycle moves from "gate_2" to "end_refusal" by "gate:refused"
    And the requester receives an end-of-cycle notification
    And the tool's mock-up container is removed
    And the tool's scoping subdomain is removed
    And the admin is asked to archive the tool's repository in the forge
    And the tool is archived
    And no data of the cycle is deleted
    Given a tool in production with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    And an evolution cycle in state "gate_2" for this tool with digest "sha256:3333333333333333333333333333333333333333333333333333333333333333" in Preview
    When the admin decides "refused" at gate "gate_2"
    Then the cycle moves from "gate_2" to "end_refusal" by "gate:refused"
    And the tool is not archived
    And the tool answers in production with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"

  @t:hardening_execution--cancellation-->end_cancellation
  Scenario: 40 bis. A cancellation by the admin of an evolution leaves the tool in prod intact; that of a creation archives the tool
    Given a tool in production with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    And an evolution cycle in state "hardening_execution" for this tool
    When the admin cancels the cycle
    Then the cycle moves from "hardening_execution" to "end_cancellation" by "cancellation"
    And the tool is not archived
    And the tool answers in production with digest "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    And table "tool_history" contains a cancellation by actor "admin@example.test"
    Given a creation cycle in state "hardening_execution" for tool "car-fleet"
    When the admin cancels the cycle
    Then the cycle moves from "hardening_execution" to "end_cancellation" by "cancellation"
    And the tool is archived
    And the requester receives an end-of-cycle notification

  Scenario: 40 ter. An archived tool can no longer receive a cycle; a tool has at most one cycle in progress
    Given an archived tool
    When an evolution request is filed for this tool
    Then creating a new cycle for this tool is refused
    Given a creation cycle in state "scoping" for tool "inventory"
    When an evolution request is filed for this tool
    Then creating a new cycle for this tool is refused
    And tool "inventory" has exactly one cycle in progress

  # The weekly summary (W6, not built yet) that lists these gates is checked by scenario 46 (operations.feature).
  @t:<gate>--timeout_exceeded--><gate>
  Scenario Outline: 41. An admin gate without an answer after 3 reminders appears "waiting > 72 h" on the dashboard, without a 4th reminder, then one reminder a week until the decision
    Given a creation cycle in state "<gate>"
    When 24 hours pass without an answer from the admin
    Then the cycle stays in state "<gate>" by "timeout_exceeded"
    And the admin has received 1 reminder
    When 24 hours pass without an answer from the admin
    And 24 hours pass without an answer from the admin
    Then the admin has received 3 reminders
    When 24 hours pass without an answer from the admin
    Then the admin has received 3 reminders
    And the cycle is in state "<gate>"
    And the admin dashboard shows the cycle "waiting > 72 h"
    And no agent task is launched
    When a week passes without an answer from the admin
    Then the admin has received a weekly reminder without a new traced reminder

    Examples:
      | gate                   |
      | gate_overlap           |
      | gate_scoping_budget    |
      | gate_scoping_blocked   |
      | gate_contract_blocked  |
      | gate_hardening_blocked |
      | gate_1                 |
      | gate_2                 |
      | gate_delivery_blocked  |
      | gate_prod_blocked      |
      | gate_incident          |

  @t:waiting_preview_feedback--timeout_exceeded-->waiting_preview_feedback
  Scenario: 41 bis. A requester silent at the Preview is reminded 3 times and then shown "waiting > 72 h": neither pause nor abandonment after the merge
    Given a creation cycle in state "waiting_preview_feedback"
    When 24 hours pass without an answer from the requester
    Then the cycle stays in state "waiting_preview_feedback" by "timeout_exceeded"
    When 24 hours pass without an answer from the requester
    And 24 hours pass without an answer from the requester
    Then the requester has received 3 reminders
    When 24 hours pass without an answer from the requester
    Then the requester has received 3 reminders
    And the cycle is in state "waiting_preview_feedback"
    And the cycle has not passed through state "scoping_pause"
    And the admin dashboard shows the cycle "waiting > 72 h"
    And the tool's Preview stays deployed

  @t:<gate>--gate:correction--><to>
  Scenario Outline: 41 ter. A correction from the admin at a blocking gate becomes the instruction of the restarted step
    Given a creation cycle in state "<gate>"
    When the admin decides "correction" at gate "<gate>" with text "Use the internal authentication library"
    Then the cycle moves from "<gate>" to "<to>" by "gate:correction"
    And the next agent task launched has "Use the internal authentication library" in its context
    And table "approvals" contains a "correction" decision for gate "<gate>" with comment "Use the internal authentication library"

    Examples:
      | gate                   | to                  |
      | gate_scoping_blocked   | repo_creation       |
      | gate_contract_blocked  | contract            |
      | gate_hardening_blocked | hardening_execution |
      | gate_delivery_blocked  | hardening_execution |
      | gate_prod_blocked      | hardening_execution |

  # D12: when the budget is what opened the gate, a "correction" without a top-up sends back to scoping, whose budget
  # check reopens the gate at once; the instruction is kept and goes with the first scoping the budget allows.
  @t:gate_scoping_budget--gate:correction-->scoping
  Scenario: 41 ter bis. A correction without a top-up at the budget gate reopens the gate at once; the instruction goes with the first scoping started
    Given a creation cycle in state "gate_scoping_budget"
    When the admin decides "correction" at gate "gate_scoping_budget" with text "Use the internal authentication library"
    Then the cycle moves from "gate_scoping_budget" to "scoping" by "gate:correction"
    And the cycle moves from "scoping" to "gate_scoping_budget" by "guard:budget_exceeded"
    And table "tasks" contains no "scoping" task
    And table "approvals" contains a "correction" decision for gate "gate_scoping_budget" with comment "Use the internal authentication library"
    When the admin decides "approved" at gate "gate_scoping_budget" with a top-up of 5 $
    Then the cycle moves from "gate_scoping_budget" to "scoping" by "gate:approved"
    And task "scoping" of iteration 1 has "Use the internal authentication library" in its context

  @t:<gate>--gate:refused-->end_refusal
  Scenario Outline: 41 quater. A refusal from the admin at any gate ends the cycle, notifies the requester and archives the creation
    Given a creation cycle in state "<gate>"
    When the admin decides "refused" at gate "<gate>"
    Then the cycle moves from "<gate>" to "end_refusal" by "gate:refused"
    And the requester receives an end-of-cycle notification
    And the tool is archived
    And no data of the cycle is deleted
    And no agent task is launched

    Examples:
      | gate                   |
      | gate_overlap           |
      | gate_scoping_budget    |
      | gate_scoping_blocked   |
      | gate_contract_blocked  |
      | gate_hardening_blocked |
      | gate_1                 |
      | gate_2                 |
      | gate_delivery_blocked  |
      | gate_prod_blocked      |
      | gate_incident          |

  Scenario: I0-1. A requester does not decide at a gate and does not cancel: refused before anything, the cycle still waits for the admin
    Given a creation cycle in state "gate_1"
    When the requester tries to decide "approved" at gate "gate_1"
    Then the decision is refused with message "admin hat required"
    When the requester tries to cancel the cycle
    Then the decision is refused with message "admin hat required"
    And the cycle is in state "gate_1"
    And table "approvals" contains no decision for gate "gate_1"
    When the admin decides "approved" at gate "gate_1"
    Then table "approvals" contains a "approved" decision at gate "gate_1" by actor "admin@example.test" under hat "admin"

  Scenario: I0-2. Four eyes: the requester of the tool does not approve their own Gate 2, even with the admin hat; a refusal or a correction stays possible for them
    Given a creation cycle requested by the admin in state "gate_2"
    When the admin tries to approve gate "gate_2" for the candidate digest
    Then the decision is refused with message "four eyes"
    And the cycle is in state "gate_2"
    And table "approvals" contains no decision for gate "gate_2"
    When the admin decides "correction" at gate "gate_2" with text "I am reworking the sorting per site"
    Then the cycle moves from "gate_2" to "hardening_execution" by "gate:correction"

  Scenario: I0-3. Actor merge: the requester back under a new subject (second actor merged by the admin) does not approve Gate 2 of the tool requested under their first actor, even with the admin hat
    Given a creation cycle in state "gate_2"
    And the admin has merged a second actor into the requester
    When the requester's second actor tries to approve gate "gate_2" for the candidate digest with the admin hat
    Then the decision is refused with message "four eyes"
    And the cycle is in state "gate_2"
    And table "approvals" contains no decision for gate "gate_2"
    When the admin decides "correction" at gate "gate_2" with text "I am reworking the sorting per site"
    Then the cycle moves from "gate_2" to "hardening_execution" by "gate:correction"

