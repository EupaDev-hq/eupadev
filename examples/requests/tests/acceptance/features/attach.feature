Feature: Attach a photo or a PDF (S2)
  As a requester, I add a photo of the problem to my request.
  Must not change: one attachment per request.

  Scenario: The author attaches a photo, which downloads; a second file replaces it
    Given reader has a draft request "Leak under the sink"
    When reader attaches the file "leak.png"
    Then reader sees the attachment "leak.png" and downloads it
    When reader attaches the file "quote.pdf"
    Then reader sees the attachment "quote.pdf" and downloads it

  Scenario: A long file name is cut to 120 characters without splitting one
    Given reader has a draft request "Leak under the sink"
    When reader attaches a photo whose name has an emoji as its 120th character
    Then reader sees the attachment under its first 120 characters

  Scenario: A page renamed as a photo is refused with a clear message
    Given reader has a draft request "Leak under the sink"
    When reader attaches an HTML page named "photo.png"
    Then reader is told "File content is not image/png"

  Scenario: A file over 5 MiB is refused before it is sent
    Given reader has a draft request "Leak under the sink"
    When reader attaches a photo of 6 MiB
    Then reader is told "File over 5 MiB"
