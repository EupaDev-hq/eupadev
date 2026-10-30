Feature: Keep the categories (S6)
  As an administrator, I add or deactivate a category.
  Must not change: a category is never deleted.

  Scenario: A new category is offered when creating a request
    When admin adds the category "Electricity"
    Then reader is offered "Electricity" when creating a request

  Scenario: A deactivated category is no longer offered, existing requests keep it
    Given reader has a draft request "Cracked pane" in "Glazing"
    When admin deactivates the category "Glazing"
    Then reader is not offered "Glazing" when creating a request
    And reader still sees "Glazing" on the request
    When reader renames her draft "Cracked pane, east side"
    Then reader still sees "Glazing" on the request
