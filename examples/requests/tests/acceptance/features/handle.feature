Feature: Take on, resolve, reject (S3)
  As a manager, I move submitted requests forward.
  Must not change: a resolved, rejected or cancelled request never changes status again.

  Scenario: The manager takes on a request, then resolves it with a note
    Given reader has a submitted request "Leaking tap"
    When manager takes it on
    Then manager sees the request as "In progress"
    And reader receives a mail "Your request is in progress"
    When manager resolves it with the note "Seal replaced"
    Then reader sees the request as "Resolved" with the closing note "Seal replaced"
    And reader receives a mail "Your request is resolved" saying "Note: Seal replaced"

  Scenario: Rejecting needs a reason
    Given reader has a submitted request "Broken chair"
    When manager rejects it without a reason
    Then the rejection is refused
    When manager rejects it with the reason "Not our scope"
    Then reader sees the request as "Rejected" with the closing note "Not our scope"
    And reader receives a mail "Your request is rejected" saying "Reason: Not our scope"

  Scenario: A closed request offers no further change
    Given reader has a resolved request "Old lamp"
    Then manager is offered no status change
    And reader is offered no status change
