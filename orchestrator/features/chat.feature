# Requester's chat, step 4 (docs/reflexions/2026-10-25-note-chat.md §6, ADR-024): the web page served by the engine,
# played in a real Chromium (tag @web: features/support/web.ts). What the requester does in the page must
# produce in the engine exactly what the CLI produces (scenario 11 of features/scoping.feature, replayed through the page).
# Tag @t:<from>--<trigger>--><to> = transition of src/machine/states.ts covered (tests/feature-coverage.test.ts).
Feature: Requester's chat in the web page
  The requester reads the whole conversation of their request in the page, answers the agents from the page, and never
  sees two requests mixed: one request = one conversation, readable by its requester or an admin only.

  Background:
    Given the default thresholds
    And the fake agent engine

  @web
  Scenario: C1. A requester reads their conversation: the need, their messages, the engine's, and what is expected of them
    Given a creation cycle in state "waiting_scoping_feedback"
    And the cycle's chat contains the requester's message "I want to track the laptops per site"
    When the requester opens the cycle's conversation in their browser
    Then the page shows message "Track the department's vehicles"
    And the page shows message "Mock-up available: https://inventory.scoping.example.test"
    And the page shows message "I want to track the laptops per site"
    And the page says "Your opinion on the mock-up is expected"

  @web
  @t:waiting_scoping_feedback--event:scoping_feedback:correction-->scoping
  Scenario: C2. (11 through the page) A correction typed in the page restarts a scoping whose context holds the whole chat history
    Given a creation cycle in state "waiting_scoping_feedback"
    And the cycle's chat contains the requester's message "I want to track the laptops per site"
    And the cycle's chat contains the orchestrator's message "Mock-up available: https://inventory.scoping.example.test"
    When the requester opens the cycle's conversation in their browser
    And the requester types "The filter per site is missing" in the chat
    Then the cycle moves from "waiting_scoping_feedback" to "scoping" by "event:scoping_feedback:correction"
    And task "scoping" of iteration 2 has "I want to track the laptops per site" in its context
    And task "scoping" of iteration 2 has "Mock-up available: https://inventory.scoping.example.test" in its context
    And task "scoping" of iteration 2 has "The filter per site is missing" in its context

  @web
  Scenario: C3. A requester with two tools sees two separate conversations
    Given a creation cycle in state "waiting_scoping_feedback" for tool "inventory"
    And the cycle's chat contains the requester's message "I want to track the laptops per site"
    And a creation cycle in state "waiting_scoping_feedback" for tool "car-fleet"
    And the cycle's chat contains the requester's message "I want to track the vehicles and their roadworthiness tests"
    When the requester opens their page in their browser
    Then their list of requests contains exactly tools "inventory" and "car-fleet"
    When the requester opens the conversation of tool "inventory"
    Then the page shows message "I want to track the laptops per site"
    And the page does not show message "I want to track the vehicles and their roadworthiness tests"
    When the requester opens the conversation of tool "car-fleet"
    Then the page shows message "I want to track the vehicles and their roadworthiness tests"
    And the page does not show message "I want to track the laptops per site"
