# Maintenance requests — specification

Format of the tool template's scoping role (its `agents/scoping.md`): this page
can be given as is to the agents to compare their tool with this one.

## Why

Maintenance needs (a door that does not close properly, a leak, a light that
is out) go today through the phone and mails: nothing is followed up, the
requester does not know where their request stands and nobody sees what is
left to do.

## Capabilities

| # | Capability | Success criterion |
|---|---|---|
| C1 | A person reports a need, with a photo or a PDF if they wish | Their request appears in "My requests" with the title, location, category, urgency and attachment they gave. |
| C2 | The requester follows their requests and sees no others | They see the state and the history of each of their own; the address of someone else's request answers "not found". |
| C3 | The manager handles the requests: taking on, resolving, rejecting with a reason | Each state change appears in the history with who and when; an impossible change (resolving a cancelled request) is refused. |
| C4 | The requester and the managers see where a request stands | The status badge and the history (who, what, when) show every change in the tool: a submitted request appears in the managers' list, a change made by a manager in the requester's request. |
| C5 | The manager exports the requests as CSV | The downloaded file holds the requests of the filter shown, one per line. |
| C6 | The administrator keeps the list of categories | An added category is offered when creating a request; a deactivated category no longer is, older requests keep it. |
| C7 | The administrator deletes a request and can restore it | A deleted request disappears from the lists; restored, it comes back unchanged. |
| C8 | Data is not kept longer than planned | After the period set, a finished request and its attachment are erased by the purge. |

## Constraints

- Three roles: requester (role `reader` of the test realm's client), manager, administrator.
- A draft is visible to its author only, whatever their role.
- One attachment per request, 5 MiB at most, PDF, PNG or JPEG.
- Two managers changing the same request at the same time: the second one is
  told that the request has changed, nothing is overwritten.

## Out of scope

- Assigning a request to a given person, deadlines and reminders.
- Several attachments, comments and messaging in the request.
- Notifications (mail or other): the platform offers no mail relay to the tools.
- Dashboard (optional, at the end of the build if time is left).

## Assumptions

- A1: the requester is the role `reader` of the test realm (decision E2 of `docs/DECISIONS.md`).
- A2: the managers find the submitted requests in their list (the tool does not know the list of managers).

## Open questions

- The retention periods, to be fixed by the client with their DPO (`docs/DECISIONS.md`).

## Stories

### S1 — Create and submit a request

As a requester, I describe a need, then send it to the service.

- Given alice signed in, When she creates a request "Door of dock 3" in category Locksmith with high urgency, Then the request is a draft and appears for her only.
- Given alice's draft, When she submits it, Then it becomes "submitted" and the history shows alice and the time.

Must not change: a draft stays invisible to the managers.

### S2 — Attach a photo or a PDF

As a requester, I add a photo of the problem to my request.

- Given alice's draft, When she uploads a 2 MiB PNG photo, Then the attachment appears and downloads.
- Given alice's draft, When she uploads a 6 MiB file or an HTML page renamed `.png`, Then the upload is refused with a clear message.

Must not change: a single attachment per request.

### S3 — Take on, resolve, reject

As a manager, I move the submitted requests forward.

- Given a submitted request of alice's, When bruno takes it on, Then it becomes "in progress" and alice sees it in the history.
- Given a request in progress, When bruno resolves it with a note, Then it becomes "resolved", the note and the change are visible to alice.
- Given a submitted request, When bruno rejects it without a reason, Then the rejection is refused; with a reason, it becomes "rejected" and alice sees the reason.

Must not change: a resolved, rejected or cancelled request no longer changes state.

### S4 — Cancel one's own request

As a requester, I cancel a request I no longer need.

- Given a submitted request of alice's, When she cancels it, Then it becomes "cancelled".
- Given a request in progress, When alice tries to cancel it, Then it is refused.

Must not change: only the author cancels their request.

### S5 — Export to CSV

As a manager, I export the filtered requests for my follow-up.

- Given requests of several categories, When bruno filters on Plumbing and exports, Then the file holds only the Plumbing requests.

Must not change: a requester has no access to the export.

### S6 — Keep the categories

As an administrator, I add, rename or deactivate a category.

- Given chloe, administrator, When she adds "Electricity", Then the category is offered when creating a request.
- Given the category "Electricity" deactivated, When alice creates a request, Then it is no longer offered; the existing requests keep it.

Must not change: a category is never deleted.

### S7 — Delete and restore a request

As an administrator, I remove a request created by mistake, and I can undo it.

- Given a request of alice's, When chloe deletes it, Then it disappears from the lists and its address answers "not found".
- Given this deleted request, When chloe restores it, Then it comes back with its state and its history.

Must not change: only the administrator deletes or restores.
