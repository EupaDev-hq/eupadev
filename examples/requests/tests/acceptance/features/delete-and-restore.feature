Feature: Delete and restore a request (S7)
  As an administrator, I remove a request created by mistake, and I can go back.
  Must not change: only the administrator deletes or restores.

  Scenario: A deleted request disappears, then comes back when restored
    Given reader has a submitted request "Duplicate entry"
    When admin deletes it
    Then reader does not find the request in the list
    And its address shows "Request not available" to reader
    When admin restores it from the deleted requests
    Then reader sees the request as "Submitted"
    And the history shows "Submitted" by "Alice Reader"

  Scenario: Only the administrator deletes
    Given reader has a submitted request "Keep me"
    Then manager is not offered to delete it
