Feature: Export to CSV (S5)
  As a manager, I export the filtered requests for my follow-up.
  Must not change: a requester has no access to the export.

  Scenario: The export follows the list filters
    Given reader has a submitted request "Plumbing job" in "Plumbing"
    And reader has a submitted request "Locksmith job" in "Locksmith"
    When manager filters the list on "Plumbing" and exports it
    Then the file holds "Plumbing job" and only "Plumbing" requests

  Scenario: A requester is not offered the export
    When reader opens the list
    Then reader is not offered the export
