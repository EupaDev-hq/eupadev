Feature: Signing in on the Preview

  Scenario: A user signs in and reads their roles
    Given a "user" signs in
    Then their roles are "user"
