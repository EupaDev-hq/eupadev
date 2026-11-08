Feature: Create and submit a request (S1)
  As a requester, I describe a need, then send it to the maintenance team.
  Must not change: a draft stays invisible to managers.

  Scenario: A new request is a draft only its author sees
    When reader creates the request "Dock 3 door" in "Locksmith" with high urgency
    Then reader sees the request "Dock 3 door" as "Draft"
    And manager does not find the request in the list

  Scenario: The author clears the description of her draft
    Given reader has a draft request "Dock 3 door" described as "Hinge broken"
    When reader clears the description of her draft
    Then reader sees the draft without a description

  Scenario: Submitting a draft records who and when
    Given reader has a draft request "Dock 3 door"
    When reader submits it
    Then reader sees the request as "Submitted"
    And manager sees the request "Dock 3 door" as "Submitted"
    And the history shows "Submitted" by "Alice Reader"
