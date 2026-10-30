# Test scenarios of the orchestrator (titles)

Starting list of the acceptance scenarios of the DBOS orchestrator, written
in Gherkin before its code (`ROADMAP.md` §8.9, step 2). They complement the
"[orchestrator test]" checks of the known errors of v1 (`ROADMAP.md`
§8.12) and cover the state machine of §8.13. All of them run with the fake
agent engine: no AI call.

**The scenarios themselves are in `orchestrator/features/`** (Gherkin,
one file per section below, same numbers in the titles):

| Section | File |
|---|---|
| Entry and overlap search | `entry-overlap.feature` |
| Scoping | `scoping.feature` |
| Hardening and review | `hardening-review.feature` |
| Gates and delivery | `delivery-gates.feature` |
| Operations | `operations.feature` |
| "[orchestrator test]" checks of §8.12 (E1 to E15) not covered below | `known-errors-v1.feature` |
| Technical incident (D21) | `technical-incident.feature` |

The scenarios added while writing the Gherkin (11 bis, 21 bis, 23 ter, 36 quinquies,
41 bis to 41 quater, E1 bis, E10 bis) and then during the robustness fixes (4 bis,
41 ter bis, E15 bis, D21, D21 bis) cover transitions of the machine that the initial
list did not touch. Each transition of `orchestrator/src/machine/states.ts`
carries a tag `@t:<from>--<trigger>--><to>` on an **executed** scenario;
`orchestrator/tests/feature-coverage.test.ts` fails if a transition has no
executed scenario or if a tag matches no real transition,
and `orchestrator/features/support/hooks.ts` fails a scenario one of whose tags
was not really traced in the history, and a complete run that leaves a
transition never traced.

## Entry and overlap search
1. A creation request starts an overlap search before any scoping.
2. A plausible overlap opens the admin gate with the agent's reason.
3. An overlap search that fails technically opens the admin gate out of caution.
4. An unreadable overlap report is treated as "to check", not as "not plausible".
4 bis. The verdict is a field of the report: a valid report without a verdict is "to check", even if its summary starts with "not_plausible".
5. A refusal at the overlap gate ends the cycle and notifies the requester.
6. A correction by the admin at the overlap gate is passed on to the first scoping.
7. An evolution request skips the overlap search and the repository creation.
7 bis. At the start of an evolution, the platform moves the tool to the latest published version of the core before any agent (decision A).
7 ter. An unreachable core registry does not stop the evolution: the cycle continues on the current version, the requester and the admin are notified.
7 quater. A tool already on the latest version of the core receives no commit; a creation never checks the core.
8. An evolution request does not ask for Gate 1 again.
9. An evolution request starts with a cycle budget at zero.
10. The repository of a new tool is created only once, even if the step is replayed.

## Scoping
11. A "not satisfied" requester restarts a scoping whose context holds the whole chat history.
12. A silent requester receives reminders at 24, 48 and 72 h; no agent is restarted.
13. At 96 h (24 h after the 3rd reminder without an answer), the tool is paused, its mock-up container is stopped and the admin is notified.
14. An answer from the requester resumes a paused tool where it stopped: mock-up restarted, then their message treated as a correction request.
14 bis. After 30 days of pause without an answer, the tool is archived: mock-up and subdomain removed, repository read-only, history and costs kept, no new cycle possible.
15. The requester can abandon their request from the chat before the merge; an abandoned creation is archived, never deleted.
15 bis. After the merge, the requester can no longer abandon it themselves: they go through the admin, who cancels.
16. A technical failure of the scoping is restarted with the error in the context.
16 bis. A failure of the repository creation opens the gate "scoping blocked"; "continue" goes through the creation again, which does nothing if the repository exists.
17. Three identical consecutive technical failures open the gate "scoping blocked".
18. A different technical failure resets the repetition counter to one; the 5th attempt in total escalates.
19. "Continue" resets the counters to zero but not the cost spent.
20. A top-up from the admin ("approve" + amount) raises the cap of the cycle and is traced.
20 bis. "Continue" without a top-up when the budget is what blocks immediately triggers the same gate again.
20 ter. A contract that fails technically or is over budget opens the gate "contract blocked", whose "continue" restarts the contract.
21. The mock-up container waits for its availability up to the configured delay before announcing the link.
22. Two tools in scoping at the same time each have their own container and subdomain.

## Hardening and review
23. A failed review task makes the round non-compliant.
23 bis. A "blocked" agent is treated as failed and its reason is shown to the admin.
24. A review report invalid against the schema makes the task failed and the round non-compliant.
25. The agents that write code receive the deviations of the previous round that concern them.
26. Only the roles that own the deviations are restarted.
27. A deviation gone for one round and then back starts again at 1; at round 4 it is the patience (D20 M3) that escalates, not the deviation.
D20 M2. The exact v1 case: the same deviation reworded for 3 rounds, line moved, label SEC-IDOR → SEC-URL → SEC-IDOR, detected by the category in the file.
D20 M7. A previous_id declared by the reviewer makes the counter inherited, and its absence never resets anything.
D20 M1. A label outside the closed list makes the report invalid: task failed, deviation report:<role> that counts like the others.
D20 M3. Patience: 3, 2, 3, 2, 3 deviations all different → "no progress" at the 5th evaluation; 3, 2, 1, 0 → merge.
D20 M4a. A role restarted for deviations that does not touch its code produces the deviation code:unchanged:<role>, visible to the admin.
D20 M4a bis. A role restarted for the sole deviation code:unchanged:<role>, which does not touch its code, produces no deviation: the round is compliant.
D20 M4a ter. After "continue" at the stagnation gate, a round with no real deviation to address ends with the merge even if the role's code has not moved.
D20 M4b. A role's Git tree back to an earlier state (A → B → A) escalates immediately, even with different labels.
D20 M5. An Opengrep finding keeps its identity (matchBasedId) when the line moves; three different findings of the same rule do not stagnate.
28. The duration counted is the agents' work, not the wait in the queue nor the human wait.
29. A task interrupted by its timeout is counted at the cost cap of the task.
29 bis. The budget is checked once before each round, not between two agents of the same round; the overrun is bounded by the number of tasks of the round × the cap per task.
30. A container already present when a step is replayed is destroyed then recreated, never duplicated.
31. A reviewer cannot write in the repository.
32. Only the orchestrator merges into `main`, and only after a compliant round.
32 bis. An out-of-scope diff detected at the merge sends back to hardening as a deviation of the round, passed on to the roles concerned, without opening a gate; a real technical failure of the merge opens the gate "delivery blocked".
33. A red CI sends back to hardening with the failed checks, without resetting the counters.
33 bis. A CI or a Preview pipeline silent for 60 min opens the gate "delivery blocked"; "retry" starts again from the merge without restarting any agent.

## Gates and delivery
34. Gate 1 is asked only once, not at the second Preview of the same tool.
34 bis. At Gate 1, a "correction" from the admin goes back to hardening (contract unchanged); a "scope change" goes back to the contract; never to scoping.
35. A "bug" correction chosen by the requester at the Preview goes back to hardening, never to scoping.
36. A "new capability" correction chosen by the requester at the Preview goes back to the contract.
36 bis. A red Preview pipeline automatically sends back to hardening with the failed checks; a green pipeline opens Gate 2.
36 ter. A red Preview pipeline that comes back round after round escalates to the admin through the hardening guard-rails, and the admin sees which check fails, its result and for how many rounds.
36 quater. A failed Preview deployment opens the gate "delivery blocked".
36 quinquies. A failed Prod deployment opens the gate "prod blocked"; the last healthy prod deployment stays the reference; "retry" restarts only the Prod deployment of the same approved digest.
37. Gate 2 shows the digest, the results of the Preview pipeline and the new dependencies.
38. An approved Gate 2 deploys to production exactly the approved digest, which can only be the candidate digest (any other is refused on entry).
39. A correction from the admin at Gate 2 goes back to hardening with its text.
40. A refusal at Gate 2 ends the cycle, notifies the requester and cleans up the resources; a refused creation is archived, a refused evolution leaves the tool in prod intact.
40 bis. A cancellation by the admin of an evolution leaves the tool in prod intact; that of a creation archives the tool.
40 ter. An archived tool can no longer receive a cycle; a tool has at most one cycle in progress.
41. An admin gate without an answer after 3 reminders appears "waiting > 72 h" on the dashboard, without a 4th reminder (the weekly summary is checked by scenario 46).
41 bis. A requester silent at the Preview is reminded 3 times and then shown "waiting > 72 h": neither pause nor abandonment after the merge.
41 ter. A correction from the admin at a blocking gate becomes the instruction of the restarted step.
41 ter bis. A correction without a top-up at the budget gate reopens the gate at once; the instruction goes with the first scoping started (D12).
41 quater. A refusal from the admin at any gate ends the cycle, notifies the requester and archives the creation.

## Technical incident (D21)
D21. An internal error in any non-final state opens the incident gate with the exact error, the workflow stays alive; "retry" resumes that state and that state only.
D21 bis. After "retry", the state of origin is processed again from the start and the cycle runs to the end.

## Operations
42. A tool without access since day 83 receives the alert, then each step only once.
43. A real access after day 90 resets the decommissioning to zero without sending any mail.
44. A tool already beyond day 104 at the first check receives the official notice before the archiving instruction.
45. The quarantine really stops the deployment without deleting the data.
46. The weekly summary lists costs, tasks, delivered tools and gates waiting for more than 72 h.
47. At N = 1, the tasks of two tools run in the order of the queue, without interference.
