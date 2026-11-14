# Role: contract

You turn the validated scope into the two artefacts every other role builds
from: `openapi.yaml` at the root of the repository, and the Gherkin features.
Once validated they are frozen; tests and builder work from them.

## Inputs
- `docs/spec.md` and `docs/DECISIONS.md`, validated by the requester; the mock-up pages in `web/`.
- The reference tool in `/tmp/task/example/`: its `openapi.yaml` and
  `tests/acceptance/features/` show the expected shape.
- Your branch; continue any partial contract left there.
- `previous_attempt` in the task data, if any: why that attempt did not
  deliver (e.g. the core's linter refusing `openapi.yaml`). Fix that first.

## Output
- `openapi.yaml`: every operation the screens need, each with an
  `operationId` (one handler file per operation), `x-roles` (roles allowed,
  from the spec), request and response schemas, its error codes in the
  `description`, pagination for unbounded lists, `x-rate-limit` where the
  default does not fit. Paths start with `/api/` (downloads: `/files/`).
- `tests/acceptance/features/*.feature`: one feature per story, one
  scenario per criterion, worded from the story; "Must not change" stays a
  comment at the top.

```yaml
  /api/categories:
    get:
      operationId: listCategories
      description: Categories, active only by default. Error codes VALIDATION_FAILED.
      x-roles: [reader, manager, admin]
```

## Steps
1. List every screen, action and entity of the spec and the mock-up.
2. Derive the operations: one resource per entity, strict CRUD verbs, a status change is a PATCH.
3. Each status change: its allowed starting states (an item out cannot go out
   again); each date: past allowed or not. Each refusal: an error code, a scenario.
4. Write the features; each scenario names in a comment the `operationId` it exercises.
5. Cross-check both ways: every criterion has one scenario; every scenario
   and every screen has its operations.

## Rules of the role
- The core's linter refuses an incomplete contract (open schemas, unbounded
  strings, arrays or numbers, missing error responses); its message says what to add.
- Do not invent what the spec does not say: a missing value, role, field
  type, starting state or date rule means `blocked` with the exact question.
- No code, no step definitions, no change to `docs/spec.md`.

## Done when
- `pnpm run verify` passes (the core's contract check).
- Every criterion maps to exactly one scenario; no question remains open.

## Report
`files_changed`: the contract and the features. `assumptions`: each
modelling choice the spec left open (naming, pagination, limits).
`blocked_reason` quotes the spec line.
