# Scenarios 23 to 33 of docs/orchestrator-scenarios.md — hardening loop, reviews, merge, CI.
# Tag @t:<from>--<trigger>--><to> = transition of src/machine/states.ts covered (tests/feature-coverage.test.ts).
# Tag @to-wire = scenario without Cucumber step definitions for now (excluded from `pnpm test:bdd`, counted by tests/feature-coverage.test.ts).
Feature: Hardening and review
  A round = tests task then builder task (ADR-021), integration, read-only reviews, fail-closed evaluation.
  Guard-rails: budget 40 $ (main), 25 rounds, stagnation (ROADMAP D20, M1 to M7: same deviation rule + file,
  or category + file, or previous_id 3 consecutive rounds; no new minimum of deviations for 3 evaluations;
  unchanged Git tree of a role = deviation, back to an earlier state = oscillation), 4 h of agent work;
  per task, caps per role (provisional, A-R5: 60 min, 150 turns, 10 $; 4 $ for overlap and scoping). The "D20 Mn" scenarios replay each mechanism with the fake engine;
  tests/stagnation.test.ts computes them on the pure functions of src/hardening/stagnation.ts.

  Background:
    Given the default thresholds
    And the fake agent engine

  @t:hardening_execution--task:done-->hardening_integration
  @t:hardening_integration--task:done-->hardening_review
  @t:hardening_review--task:failed-->hardening_evaluation
  @t:hardening_evaluation--guard:non_compliant-->hardening_execution
  Scenario: 23. A failed review task makes the round non-compliant
    Given a creation cycle in state "hardening_execution"
    When the fake engine returns a compliant report for roles "tests, builder"
    Then the cycle moves from "hardening_execution" to "hardening_integration" by "task:done"
    When the integration of the role branches succeeds
    Then the cycle moves from "hardening_integration" to "hardening_review" by "task:done"
    When the fake engine returns a compliant report for "quality-reviewer"
    And the fake engine returns a failure for "security-reviewer" with reason "container stopped: OOM"
    Then the cycle moves from "hardening_review" to "hardening_evaluation" by "task:failed"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And the cycle's round counter is 2
    And the cycle has not passed through state "merge"

  @t:hardening_execution--task:failed-->hardening_evaluation
  Scenario: 23 bis. A "blocked" agent is treated as failed and its reason is shown to the admin
    Given a creation cycle in state "hardening_execution"
    When the fake engine returns state "blocked" for "builder" with reason "The contract requires a site_id column missing from the schema"
    And the fake engine returns a compliant report for roles "tests"
    Then the cycle moves from "hardening_execution" to "hardening_evaluation" by "task:failed"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And task "builder" of iteration 1 has status "blocked"
    And the admin dashboard shows for task "builder" of iteration 1 reason "The contract requires a site_id column missing from the schema"

  Scenario: A-R2a. A failed or blocked tests task stops the round: the builder is not started; the next round restarts tests, then the builder that has never delivered, and the reviewers only come after it
    Given a creation cycle in state "hardening_execution"
    When the fake engine returns state "blocked" for "tests" with reason "The contract does not say who can read /tools"
    Then the cycle moves from "hardening_execution" to "hardening_evaluation" by "task:failed"
    And table "tasks" contains no "builder" task for iteration 1
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    # Cycle 5 of the lab: a tests-only round followed by two reviews of a repository the builder had never touched.
    When the fake engine returns a compliant report for roles "tests, builder"
    Then table "tasks" contains exactly one "tests" task for iteration 2
    And table "tasks" contains exactly one "builder" task for iteration 2
    And task "tests" of iteration 2 was created before task "builder"
    And the cycle moves from "hardening_execution" to "hardening_integration" by "task:done"
    When the integration of the role branches succeeds
    And the fake engine returns a compliant report for roles "security-reviewer, quality-reviewer"
    Then the cycle moves from "hardening_integration" to "hardening_review" by "task:done"
    And table "tasks" contains no "security-reviewer" task for iteration 1
    And the engine received for task "security-reviewer" of iteration 2 this model, this effort and branch "integration/<cycle>/2"

  Scenario: A-R2a bis. A defect of the suite raised by the builder becomes a deviation of the tests role, even if it cites the contract; its other findings are not deviations
    Given a creation cycle in state "hardening_execution"
    When the fake engine returns a compliant report for "tests"
    And the fake engine returns for "builder" a report with the deviations:
      | rule               | file                                  | owner_role | previous_id | message                                              |
      | tests.md#Execution | tests/acceptance/steps/list.js        | tests      | F-009       | the "empty list" step expects 404, the contract 200  |
      | SEC-IDOR           | openapi.yaml                          | tests      |             | /tools/{id}: the test reads the tool of another site |
      | SEC-IDOR           | api/tools.js                          | builder    |             | site check to add                                    |
      | SEC-XSS            | tests/acceptance/security/xss.spec.js | tests      |             | api/tools.js:12 returns the name without escaping    |
    Then the cycle moves from "hardening_execution" to "hardening_integration" by "task:done"
    When the integration of the role branches succeeds
    And the fake engine returns a compliant report for roles "security-reviewer, quality-reviewer"
    Then the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And task "tests" of iteration 2 receives deviation "tests.md#Execution" on "tests/acceptance/steps/list.js"
    # A-R6, C2: evidence that cites code is withheld; rule, file and line go through.
    And task "tests" of iteration 2 receives from the builder finding "SEC-XSS" on "tests/acceptance/security/xss.spec.js" with evidence "withheld: cited code"
    And task "tests" of iteration 2 receives deviation "SEC-IDOR" on "openapi.yaml"
    And task "tests" of iteration 2 does not receive deviation "SEC-IDOR" on "api/tools.js"
    And task "tests" of iteration 2 receives from the builder finding "SEC-IDOR" on "openapi.yaml" with evidence "/tools/{id}: the test reads the tool of another site"
    When the fake engine returns a compliant report for "tests"
    # All the deviations of the round targeted tests: the builder is not restarted.
    Then the cycle moves from "hardening_execution" to "hardening_integration" by "task:done"
    And table "tasks" contains no "builder" task for iteration 2

  Scenario: A-R2a ter. A builder blocked by a test that contradicts the contract: the test goes to the tests role, the builder is restarted afterwards
    Given a creation cycle in state "hardening_execution"
    When the fake engine returns a compliant report for "tests"
    And the fake engine returns for "builder" state "blocked" with the deviations:
      | rule               | file                           | owner_role |
      | tests.md#Execution | tests/acceptance/steps/list.js | tests      |
    Then the cycle moves from "hardening_execution" to "hardening_evaluation" by "task:failed"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And task "tests" of iteration 2 receives deviation "tests.md#Execution" on "tests/acceptance/steps/list.js"
    When the fake engine returns a compliant report for "tests"
    Then task "builder" of iteration 2 receives deviation "report:builder" on "report"
    And task "builder" of iteration 2 does not receive deviation "tests.md#Execution" on "tests/acceptance/steps/list.js"

  @t:hardening_integration--task:failed-->hardening_evaluation
  Scenario: 23 ter. An impossible integration makes the round non-compliant
    Given a creation cycle in state "hardening_integration"
    When the integration of the role branches fails with conflict "api/tools.js"
    Then the cycle moves from "hardening_integration" to "hardening_evaluation" by "task:failed"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And task "builder" of iteration 2 has "conflict: api/tools.js" in its context

  Scenario: 24. A review report invalid against the schema makes the task failed and the round non-compliant
    Given a creation cycle in state "hardening_review"
    # A reviewer reviews the integrated code of the round (integration branch), never main, which does not have it yet.
    Then the engine received for task "security-reviewer" of iteration 1 this model, this effort and branch "integration/<cycle>/1"
    When the fake engine returns a compliant report for "quality-reviewer"
    And the fake engine returns a report invalid against the schema for "security-reviewer"
    Then task "security-reviewer" of iteration 1 has status "failed"
    And the cycle moves from "hardening_review" to "hardening_evaluation" by "task:failed"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And the cycle's round counter is 2

  @t:hardening_review--task:done-->hardening_evaluation
  Scenario: 25. The agents that write code receive the deviations of the previous round that concern them (file → owner: api/, web/ → builder; tests/acceptance/ → tests)
    Given a creation cycle in state "hardening_review"
    When the fake engine returns for "quality-reviewer" a report with the deviations:
      | rule                     | file                           | category                 |
      | quality.md#Accessibility | web/app.js                     | quality.md#Accessibility |
      | tests.md#Execution       | tests/acceptance/steps/list.js | tests.md#Execution       |
    And the fake engine returns for "security-reviewer" a report with the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    Then the cycle moves from "hardening_review" to "hardening_evaluation" by "task:done"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And task "tests" of iteration 2 receives deviation "tests.md#Execution" on "tests/acceptance/steps/list.js"
    And task "tests" of iteration 2 does not receive deviation "SEC-IDOR" on "api/tools.js"
    # A-R2a: the builder's deviation (web/app.js) is written before the one of tests; the order stays tests then builder.
    And table "tasks" contains no "builder" task for iteration 2
    When the fake engine returns a compliant report for "tests"
    Then task "builder" of iteration 2 receives deviation "SEC-IDOR" on "api/tools.js"
    And task "builder" of iteration 2 receives deviation "quality.md#Accessibility" on "web/app.js"
    And task "builder" of iteration 2 does not receive deviation "tests.md#Execution" on "tests/acceptance/steps/list.js"

  Scenario: 26. Only the roles that own the deviations are restarted
    Given a creation cycle in state "hardening_review"
    When the fake engine returns a compliant report for "quality-reviewer"
    And the fake engine returns for "security-reviewer" a report with the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    Then the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And table "tasks" contains exactly one "builder" task for iteration 2
    And table "tasks" contains no "tests" task for iteration 2

  Scenario: 27. A deviation gone for one round and then back starts again at 1; at round 4 it is the patience (D20 M3) that escalates, not the deviation
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         | category             |
      | SEC-IDOR | api/tools.js | security.md#Requests |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule     | file         | category             |
      | SEC-IDOR | api/tools.js | security.md#Requests |
    Then the stagnation counter of deviation "SEC-IDOR" on "api/tools.js" is 2
    And the stagnation counter of category "security.md#Requests" on "api/tools.js" is 2
    When hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule    | file         | category              |
      | SEC-XSS | api/views.js | security.md#Responses |
    Then the stagnation counter of deviation "SEC-IDOR" on "api/tools.js" is 0
    And the stagnation counter of category "security.md#Requests" on "api/tools.js" is 0
    And the cycle is in state "hardening_execution"
    And the cycle has not passed through state "gate_hardening_blocked"
    When hardening round 4 is played with, for "security-reviewer", the deviations:
      | rule     | file         | category             |
      | SEC-IDOR | api/tools.js | security.md#Requests |
    Then the stagnation counter of deviation "SEC-IDOR" on "api/tools.js" is 1
    And the stagnation counter of category "security.md#Requests" on "api/tools.js" is 1
    And the number of deduplicated deviations of rounds 1 to 4 is "1, 1, 1, 1"
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "no progress for 3 rounds"
    And the notification sent to the admin does not contain "deviation SEC-IDOR api/tools.js present for"

  Scenario: D20 M2. The exact v1 case: the same deviation reworded for 3 rounds, line moved, label SEC-IDOR → SEC-URL → SEC-IDOR, detected by the category in the file
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | id    | rule     | file         | line | category             | message                                       |
      | F-001 | SEC-IDOR | api/tools.js | 42   | security.md#Requests | The tool id is not checked on the server side |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | id    | rule    | file         | line | category             | message                                                  |
      | F-001 | SEC-URL | api/tools.js | 45   | security.md#Requests | The URL /api/tools/:id is readable by any signed-in user |
    Then the stagnation counter of deviation "SEC-IDOR" on "api/tools.js" is 0
    And the stagnation counter of deviation "SEC-URL" on "api/tools.js" is 1
    And the stagnation counter of category "security.md#Requests" on "api/tools.js" is 2
    And the cycle has not passed through state "gate_hardening_blocked"
    When hardening round 3 is played with, for "security-reviewer", the deviations:
      | id    | rule     | file         | line | category             | message                                     |
      | F-001 | SEC-IDOR | api/tools.js | 48   | security.md#Requests | Insecure direct reference on /api/tools/:id |
    Then the stagnation counter of deviation "SEC-IDOR" on "api/tools.js" is 1
    And the stagnation counter of category "security.md#Requests" on "api/tools.js" is 3
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "stagnation"
    And the notification sent to the admin contains "same category security.md#Requests in api/tools.js for 3 rounds"
    And table "tasks" contains no task for iteration 4

  Scenario: D20 M7. A previous_id declared by the reviewer makes the counter inherited, and its absence never resets anything
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | id    | rule     | file         | category             | previous_id |
      | F-001 | SEC-IDOR | api/tools.js | security.md#Requests |             |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | id    | rule    | file         | category                                | previous_id |
      | F-002 | SEC-URL | api/tools.js | security.md#Authentication and sessions | F-001       |
    Then the stagnation counter of deviation "SEC-URL" on "api/tools.js" is 1
    And the stagnation counter of category "security.md#Authentication and sessions" on "api/tools.js" is 1
    And the inherited counter of deviation "SEC-URL" on "api/tools.js" is 2
    And the admin dashboard shows deviation "SEC-URL" on "api/tools.js" as a follow-up of "F-001" from round 1
    When hardening round 3 is played with, for "security-reviewer", the deviations:
      | id    | rule    | file         | category                                | previous_id |
      | F-003 | SEC-URL | api/tools.js | security.md#Authentication and sessions |             |
    Then the stagnation counter of deviation "SEC-URL" on "api/tools.js" is 2
    And the inherited counter of deviation "SEC-URL" on "api/tools.js" is 0
    And the cycle has not passed through state "gate_hardening_blocked"
    When hardening round 4 is played with, for "security-reviewer", the deviations:
      | id    | rule     | file         | category             | previous_id |
      | F-004 | SEC-ROLE | api/tools.js | security.md#Requests | F-003       |
    Then the stagnation counter of deviation "SEC-ROLE" on "api/tools.js" is 1
    And the inherited counter of deviation "SEC-ROLE" on "api/tools.js" is 3
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "inherited (previous_id) for 3 rounds"

  Scenario: D20 M1. A label outside the closed list makes the report invalid: task failed, deviation report:<role> that counts like the others
    Given a creation cycle in state "hardening_review"
    When the fake engine returns a compliant report for "quality-reviewer"
    And the fake engine returns for "security-reviewer" a report with deviation "SEC-AUTHZ" on "api/tools.js", a label missing from the schema's closed list
    Then task "security-reviewer" of iteration 1 has status "failed"
    And the cycle moves from "hardening_review" to "hardening_evaluation" by "task:failed"
    And table "deviations" contains for iteration 1 deviation "report:security-reviewer" on "report"
    And table "deviations" contains for iteration 1 no deviation "SEC-AUTHZ"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    When hardening round 2 is played with, for "security-reviewer", a report whose category "security.md#Authorization" is missing from the schema's closed list
    And hardening round 3 is played with, for "security-reviewer", a report whose category "security.md#Authorization" is missing from the schema's closed list
    Then the stagnation counter of deviation "report:security-reviewer" on "report" is 3
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "report:security-reviewer"
    And the notification sent to the admin contains "invalid or missing report"

  @t:hardening_evaluation--guard:compliant-->merge
  Scenario: D20 M3. Patience: 3, 2, 3, 2, 3 deviations all different → "no progress" at the 5th evaluation; 3, 2, 1, 0 → merge
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule       | file          | category                                  |
      | SEC-IDOR   | api/tools.js  | security.md#Requests                      |
      | SEC-HEAD   | api/index.js  | security.md#Responses                     |
      | SEC-STATIC | api/static.js | security.md#Static files and browser code |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule       | file           | category                                |
      | SEC-CSRF   | api/tools.js   | security.md#Requests                    |
      | SEC-COOKIE | api/session.js | security.md#Authentication and sessions |
    And hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule     | file          | category                                |
      | SEC-RATE | api/sends.js  | security.md#Requests                    |
      | SEC-ERR  | api/errors.js | security.md#Responses                   |
      | SEC-AUTH | api/health.js | security.md#Authentication and sessions |
    And hardening round 4 is played with, for "security-reviewer", the deviations:
      | rule      | file         | category             |
      | SEC-VALID | api/tools.js | security.md#Requests |
      | SEC-MASS  | api/sites.js | security.md#Requests |
    Then the number of deduplicated deviations of rounds 1 to 4 is "3, 2, 3, 2"
    And the cycle has not passed through state "gate_hardening_blocked"
    When hardening round 5 is played with, for "security-reviewer", the deviations:
      | rule     | file         | category                                  |
      | SEC-SQLI | api/tools.js | security.md#Requests                      |
      | SEC-URL  | web/app.js   | security.md#Static files and browser code |
      | SEC-ROLE | api/admin.js | security.md#Authentication and sessions   |
    Then the number of deduplicated deviations of rounds 1 to 5 is "3, 2, 3, 2, 3"
    And no deviation or category stagnation counter reaches 3
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "no progress for 3 rounds"
    And the notification sent to the admin contains "3, 2, 3, 2, 3"
    # Second part: each round fixes its deviations and finds only new, fewer ones (no deviation or
    # category in the same file 3 rounds in a row, otherwise the M2 stagnation would escalate, D20).
    Given a creation cycle in state "hardening_execution" for tool "car-fleet"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         | category              |
      | SEC-IDOR | api/tools.js | security.md#Requests  |
      | SEC-HEAD | api/index.js | security.md#Responses |
      | SEC-CSRF | api/sites.js | security.md#Requests  |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule       | file           | category                                |
      | SEC-COOKIE | api/session.js | security.md#Authentication and sessions |
      | SEC-RATE   | api/sends.js   | security.md#Requests                    |
    And hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule    | file          | category              |
      | SEC-ERR | api/errors.js | security.md#Responses |
    And hardening round 4 is played with, for "security-reviewer", the deviations:
      | rule | file |
    Then the number of deduplicated deviations of rounds 1 to 4 is "3, 2, 1, 0"
    And the cycle moves from "hardening_evaluation" to "merge" by "guard:compliant"
    And the cycle has not passed through state "gate_hardening_blocked"

  Scenario: D20 M4a. A role restarted for deviations that does not touch its code produces the deviation code:unchanged:<role>, visible to the admin
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         | category             |
      | SEC-IDOR | api/tools.js | security.md#Requests |
    Then task "builder" of iteration 1 has a tree hash
    And task "builder" of iteration 2 receives deviation "SEC-IDOR" on "api/tools.js"
    When the fake engine returns a compliant report for "builder" without changing any file
    And the fake engine returns for "security-reviewer" a report with the deviations:
      | rule     | file         | category             |
      | SEC-IDOR | api/tools.js | security.md#Requests |
    Then the tree hash of task "builder" of iteration 2 equals the one of iteration 1
    And table "deviations" contains for iteration 2 deviation "code:unchanged:builder" on "builder"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    And task "builder" of iteration 3 receives deviation "code:unchanged:builder" on "builder"
    And the admin dashboard shows for iteration 2 deviation "code:unchanged:builder"
    And the cycle has not passed through state "gate_hardening_blocked"

  # Lab cycle 43: code:unchanged:builder was sent back to the builder, which had nothing left to fix, touched nothing and
  # reproduced the deviation — dead end (stagnation, then a loop after "continue"). A role restarted without a real deviation does not stagnate.
  @t:hardening_evaluation--guard:compliant-->merge
  Scenario: D20 M4a bis. A role restarted for the sole deviation code:unchanged:<role>, which does not touch its code, produces no deviation: the round is compliant
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         | category             |
      | SEC-IDOR | api/tools.js | security.md#Requests |
    Then task "builder" of iteration 2 receives deviation "SEC-IDOR" on "api/tools.js"
    # Round 2: the builder, restarted for SEC-IDOR, is blocked (package not found in the sandbox) without having touched the code:
    # report:builder and code:unchanged:builder, both justified.
    When the fake engine returns state "blocked" for "builder" with reason "npm install: package not found from the sandbox" without changing any file
    Then the cycle moves from "hardening_execution" to "hardening_evaluation" by "task:failed"
    And table "deviations" contains for iteration 2 deviation "report:builder" on "report"
    And table "deviations" contains for iteration 2 deviation "code:unchanged:builder" on "builder"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    # Round 3: restarted for its blocked report (a real deviation), the builder returns a valid report without touching the code: code:unchanged:builder
    # still counts; the quality reviewer targets the suite (tests role).
    When the fake engine returns a compliant report for "builder" without changing any file
    And hardening round 3 is played with, for "quality-reviewer", the deviations:
      | rule               | file                            | category           |
      | tests.md#Execution | tests/acceptance/steps/list.js  | tests.md#Execution |
      | tests.md#Execution | tests/acceptance/steps/sites.js | tests.md#Execution |
    Then table "deviations" contains for iteration 3 deviation "code:unchanged:builder" on "builder"
    And the cycle moves from "hardening_evaluation" to "hardening_execution" by "guard:non_compliant"
    # Round 4: tests fixes its suite; the builder had nothing real to address and touches nothing; the reviewers find nothing.
    When the fake engine returns a compliant report for "builder" without changing any file
    And hardening round 4 is played with, for "quality-reviewer", the deviations:
      | rule | file |
    Then task "tests" of iteration 4 receives deviation "tests.md#Execution" on "tests/acceptance/steps/list.js"
    And task "builder" of iteration 4 receives deviation "code:unchanged:builder" on "builder"
    And the tree hash of task "builder" of iteration 4 equals the one of iteration 3
    And table "deviations" contains for iteration 4 no deviation "code:unchanged:builder"
    And the cycle moves from "hardening_evaluation" to "merge" by "guard:compliant"
    And the cycle has not passed through state "gate_hardening_blocked"

  @t:gate_hardening_blocked--gate:approved-->hardening_execution
  Scenario: D20 M4a ter. After "continue" at the stagnation gate, a round with no real deviation to address ends with the merge even if the role's code has not moved
    Given a creation cycle in state "hardening_execution"
    And deviation "SEC-IDOR" on "api/tools.js" present in the last 2 rounds
    When the fake engine returns a compliant report for "builder" without changing any file
    And hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    Then the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "SEC-IDOR api/tools.js present for 3 rounds"
    When the admin decides "approved" at gate "gate_hardening_blocked"
    Then the cycle moves from "gate_hardening_blocked" to "hardening_execution" by "gate:approved"
    # Counters reset to zero: tests and builder start again without deviations; the builder still touches nothing, the reviewers find nothing.
    When the fake engine returns a compliant report for "builder" without changing any file
    And hardening round 4 is played with, for "security-reviewer", the deviations:
      | rule | file |
    Then the tree hash of task "builder" of iteration 4 equals the one of iteration 3
    And table "deviations" contains for iteration 4 no deviation "code:unchanged:builder"
    And the cycle moves from "hardening_evaluation" to "merge" by "guard:compliant"

  Scenario: D20 M4b. A role's Git tree back to an earlier state (A → B → A) escalates immediately, even with different labels
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         | category             |
      | SEC-IDOR | api/tools.js | security.md#Requests |
    And hardening round 2 is played with, for "quality-reviewer", the deviations:
      | rule           | file         | category       |
      | quality.md#API | api/tools.js | quality.md#API |
    Then the tree hash of task "builder" of iteration 2 differs from the one of iteration 1
    When the fake engine returns a compliant report for "builder", putting its files back as they were at iteration 1
    And the fake engine returns for "security-reviewer" a report with the deviations:
      | rule    | file         | category             |
      | SEC-URL | api/tools.js | security.md#Requests |
    Then the tree hash of task "builder" of iteration 3 equals the one of iteration 1
    And no deviation or category stagnation counter reaches 3
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "oscillation of the code of role builder"
    And table "tasks" contains no task for iteration 4

  Scenario: D20 M5. An Opengrep finding keeps its identity (matchBasedId) when the line moves; three different findings of the same rule do not stagnate
    Given a creation cycle in state "waiting_ci"
    And the cycle's round counter is 1
    When check "analysis" of the next CI carries the SARIF findings:
      | ruleId                  | matchBasedId | file       | line |
      | innerhtml-variable-text | abc_0        | web/app.js | 10   |
    And the forge signals "ci_finished" with result "red" and the failed checks:
      | check    | result |
      | analysis | red    |
    Then table "deviations" contains for iteration 1 deviation "ci:opengrep:abc_0" on "web/app.js"
    And task "builder" of iteration 2 receives deviation "ci:opengrep:abc_0" on "web/app.js"
    And table "tasks" contains no "tests" task for iteration 2
    When hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule | file |
    And the delivery up to the CI replays
    And check "analysis" of the next CI carries the SARIF findings:
      | ruleId                  | matchBasedId | file       | line |
      | innerhtml-variable-text | abc_0        | web/app.js | 13   |
    And the forge signals "ci_finished" with result "red" and the failed checks:
      | check    | result |
      | analysis | red    |
    And hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule | file |
    And the delivery up to the CI replays
    And check "analysis" of the next CI carries the SARIF findings:
      | ruleId                  | matchBasedId | file       | line |
      | innerhtml-variable-text | abc_0        | web/app.js | 17   |
    And the forge signals "ci_finished" with result "red" and the failed checks:
      | check    | result |
      | analysis | red    |
    Then the stagnation counter of deviation "ci:opengrep:abc_0" on "web/app.js" is 3
    And the cycle moves from "waiting_ci" to "hardening_execution" by "event:ci_finished:red"
    And the cycle moves from "hardening_execution" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "ci:opengrep:abc_0 web/app.js present for 3 rounds"
    Given a creation cycle in state "waiting_ci" for tool "car-fleet"
    And the cycle's round counter is 1
    When check "analysis" of the next CI carries the SARIF findings:
      | ruleId                  | matchBasedId | file       | line |
      | innerhtml-variable-text | a_0          | web/app.js | 10   |
    And the forge signals "ci_finished" with result "red" and the failed checks:
      | check    | result |
      | analysis | red    |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule | file |
    And the delivery up to the CI replays
    And check "analysis" of the next CI carries the SARIF findings:
      | ruleId                  | matchBasedId | file        | line |
      | innerhtml-variable-text | b_0          | web/list.js | 4    |
    And the forge signals "ci_finished" with result "red" and the failed checks:
      | check    | result |
      | analysis | red    |
    And hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule | file |
    And the delivery up to the CI replays
    And check "analysis" of the next CI carries the SARIF findings:
      | ruleId                  | matchBasedId | file          | line |
      | innerhtml-variable-text | c_0          | web/detail.js | 8    |
    And the forge signals "ci_finished" with result "red" and the failed checks:
      | check    | result |
      | analysis | red    |
    Then the stagnation counter of deviation "ci:opengrep:c_0" on "web/detail.js" is 1
    And the cycle moves from "waiting_ci" to "hardening_execution" by "event:ci_finished:red"
    And the cycle has not passed through state "gate_hardening_blocked"

  @t:hardening_evaluation--guard:escalation-->gate_hardening_blocked
  Scenario: 28. The duration counted is the agents' work, not the wait in the queue nor the human wait
    Given a creation cycle in state "hardening_execution"
    And a cumulative agent work duration of 222 minutes on the cycle
    When the fake engine declares a queue wait of 30 minutes per task
    And the fake engine declares a work duration of 2 minutes per task
    And hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    Then the cycle's agent work duration is 230 minutes
    And the cycle is in state "hardening_execution"
    # Round 1: tests, builder and the two reviewers (4 tasks); round 2: only the role that owns the deviation (builder) is restarted, with the two reviewers (decision 26): 3 tasks.
    When the fake engine declares a work duration of 4 minutes per task
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    Then the cycle's agent work duration is 242 minutes
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "duration"
    When 48 hours pass without an answer from the admin
    Then the cycle's agent work duration is 242 minutes

  Scenario: 29. A task interrupted by its timeout is counted at the cost cap of the task
    Given a creation cycle in state "hardening_execution"
    When the fake engine returns a compliant report for "tests"
    And the fake engine does not answer for "builder" for 60 minutes
    Then task "builder" of iteration 1 has status "failed"
    And task "builder" of iteration 1 has a cost of 10 $
    And the container of task "builder" of iteration 1 is stopped

  @t:contract--task:done-->hardening_execution
  Scenario: 29 ter. A cost not declared by the engine is counted at the task's cap, never 0 $
    Given a creation cycle in state "contract"
    When the fake engine returns a compliant report for "contract" without a declared cost
    Then the cycle moves from "contract" to "hardening_execution" by "task:done"
    And task "contract" of iteration 1 has a cost of 10 $

  @t:hardening_execution--guard:budget_exceeded-->gate_hardening_blocked
  @t:gate_hardening_blocked--gate:approved-->hardening_execution
  Scenario: 29 bis. The budget is checked once before each round, not between two agents of the same round; the overrun is bounded by the number of tasks of the round × the cap per task
    Given a creation cycle in state "hardening_execution"
    And a cumulative cycle cost of 39 $
    When the fake engine declares a cost of 3 $ per task
    And hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    Then the 4 tasks of round 1 have status "done"
    And the cycle's cumulative cost is 51 $
    And the cycle's budget overrun is at most 12 $
    And the cycle moves from "hardening_evaluation" to "gate_hardening_blocked" by "guard:escalation"
    And the notification sent to the admin contains "budget"
    When the admin decides "approved" at gate "gate_hardening_blocked"
    Then the cycle moves from "gate_hardening_blocked" to "hardening_execution" by "gate:approved"
    And the cycle moves from "hardening_execution" to "gate_hardening_blocked" by "guard:budget_exceeded"
    And table "tasks" contains no "builder" task for iteration 2
    When the admin decides "approved" at gate "gate_hardening_blocked" with a top-up of 15 $
    Then the cycle moves from "gate_hardening_blocked" to "hardening_execution" by "gate:approved"
    And the cycle's hardening budget cap is 55 $
    # Counters reset to zero by the decision: both roles start again, tests first (A-R2a).
    And table "tasks" contains exactly one "tests" task for iteration 2

  @to-wire
  Scenario: 30. A container already present when a step is replayed is destroyed then recreated, never duplicated
    Given a creation cycle in state "hardening_execution"
    And a container named after task "builder" of iteration 1 already present
    When the launch step of task "builder" of iteration 1 is replayed
    Then there is exactly one container named after task "builder" of iteration 1
    And the container present before the replay has been destroyed

  @to-wire
  Scenario: 31. A reviewer cannot write in the repository
    Given a creation cycle in state "hardening_review"
    Then the container of task "security-reviewer" of iteration 1 mounts the repository read-only
    And the container of task "security-reviewer" of iteration 1 receives no Git token
    When the fake engine tries to write "api/tools.js" from "security-reviewer"
    Then the write is refused
    When the fake engine tries to push a branch from "security-reviewer"
    Then the forge has received no push for the tool

  @to-wire
  Scenario: 32. Only the orchestrator merges into `main`, and only after a compliant round
    Given a creation cycle in state "hardening_review"
    When the fake engine tries to push to "main" from "builder"
    Then the forge refuses the push because of branch protection
    When the fake engine returns a compliant report for roles "security-reviewer, quality-reviewer"
    Then the cycle moves from "hardening_review" to "hardening_evaluation" by "task:done"
    And the cycle moves from "hardening_evaluation" to "merge" by "guard:compliant"
    When the forge accepts the squash into "main"
    Then the cycle moves from "merge" to "waiting_ci" by "task:done"
    And the squash into "main" was done by account "orchestrator"
    And table "tasks" contains no task for step "merge"

  @t:merge--guard:diff_out_of_scope-->hardening_execution
  @t:merge--task:failed-->gate_delivery_blocked
  Scenario: 32 bis. An out-of-scope diff detected at the merge sends back to hardening as a deviation of the round, passed on to the roles concerned, without opening a gate; a real technical failure of the merge opens the gate "delivery blocked"
    Given a creation cycle in state "merge"
    And the iteration branch changes file ".gitea/workflows/ci.yml" from role "builder"
    When the iteration branch diff is checked per role
    Then the cycle moves from "merge" to "hardening_execution" by "guard:diff_out_of_scope"
    And the cycle has not passed through state "gate_delivery_blocked"
    And table "deviations" contains for iteration 1 deviation "scope:.gitea/workflows/ci.yml" on ".gitea/workflows/ci.yml"
    And task "builder" of iteration 2 receives deviation "scope:.gitea/workflows/ci.yml" on ".gitea/workflows/ci.yml"
    And table "tasks" contains no "tests" task for iteration 2
    And the cycle's round counter is 2
    Given a creation cycle in state "merge" for tool "car-fleet"
    When the forge is unavailable during the squash into "main"
    Then the cycle moves from "merge" to "gate_delivery_blocked" by "task:failed"
    And the notification sent to the admin contains "forge unavailable"

  @t:waiting_ci--event:ci_finished:red-->hardening_execution
  Scenario: 33. A red CI sends back to hardening with the failed checks, without resetting the counters
    Given a creation cycle in state "hardening_execution"
    When hardening round 1 is played with, for "security-reviewer", the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    And hardening round 2 is played with, for "security-reviewer", the deviations:
      | rule     | file         |
      | SEC-IDOR | api/tools.js |
    Then the stagnation counter of deviation "SEC-IDOR" on "api/tools.js" is 2
    When hardening round 3 is played with, for "security-reviewer", the deviations:
      | rule | file |
    Then the cycle moves from "hardening_evaluation" to "merge" by "guard:compliant"
    And the cycle moves from "merge" to "waiting_ci" by "task:done"
    When the forge signals "ci_finished" with result "red" and the failed checks:
      | check    | result |
      | analysis | red    |
      | tests    | red    |
      | lint     | green  |
    Then the cycle moves from "waiting_ci" to "hardening_execution" by "event:ci_finished:red"
    # A red CI without an image has no digest: only its red checks are recorded (constraint pipeline_results_digest).
    And table "pipeline_results" contains for pipeline "ci" and iteration 3 check "analysis" with result "red"
    And table "pipeline_results" contains for pipeline "ci" and iteration 3 check "tests" with result "red"
    # A red check on "pipeline" has no owner: both roles, tests first (A-R2a).
    And task "tests" of iteration 4 has "ci:analysis" in its context
    When the fake engine returns a compliant report for "tests"
    Then task "builder" of iteration 4 has "ci:analysis" in its context
    And task "builder" of iteration 4 has "ci:tests" in its context
    And the cycle's round counter is 4
    And the stagnation counter of deviation "ci:tests" on "pipeline" is 1
    And the number of deduplicated deviations of rounds 1 to 3 is "1, 1, 2"
    And the cycle has not passed through state "gate_hardening_blocked"

  @t:<state>--timeout_exceeded-->gate_delivery_blocked
  @t:gate_delivery_blocked--gate:approved-->merge
  @t:merge--task:done-->waiting_ci
  Scenario Outline: 33 bis. A CI or a Preview pipeline silent for 60 min opens the gate "delivery blocked"; "retry" starts again from the merge without restarting any agent
    Given a creation cycle in state "<state>"
    When the forge stays silent for 60 minutes
    Then the cycle moves from "<state>" to "gate_delivery_blocked" by "timeout_exceeded"
    And the notification sent to the admin contains "no result for 60 min"
    When the admin decides "approved" at gate "gate_delivery_blocked"
    Then the cycle moves from "gate_delivery_blocked" to "merge" by "gate:approved"
    And table "tasks" contains no task for iteration 2
    When the forge accepts the squash into "main"
    Then the cycle moves from "merge" to "waiting_ci" by "task:done"

    Examples:
      | state            |
      | waiting_ci       |
      | preview_pipeline |
