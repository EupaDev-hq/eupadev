Feature: Cancel one's own request (S4)
  As a requester, I cancel a request I no longer need.
  Must not change: only the author cancels a request.

  Scenario: The author cancels a submitted request
    Given reader has a submitted request "Spare key"
    When reader cancels it
    Then reader sees the request as "Cancelled"

  Scenario: A request in progress can no longer be cancelled
    Given reader has a request "Window latch" in progress
    Then reader is not offered to cancel it

  Scenario: Only the author cancels
    Given reader has a submitted request "Spare key"
    Then manager is not offered to cancel it
