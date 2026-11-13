# Report: align the harness with the course

Reviewed against `specs/align-harness-with-course/acceptance.json` (A-01 through A-34) and the code on main after PR #3 and PR #4.

## Criteria

| ID           | Test                                                | Entry point                                                                                                                           | Code path                                      | Last green run                                          |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| A-01 to A-34 | The `test` field on each entry in `acceptance.json` | Mixed. Hook and CLI criteria spawn `verify.sh` or `node harness/lib/cli.mjs`. Some panel criteria call the role through `invokeRole`. | See each test file named in `acceptance.json`. | `npm test` on this tree, after the close-the-gaps work. |

## Wiring proof

PR #3 added the review-metrics reader in `harness/lib/accounting-review.mjs`. It prints a dismissed rate from `session.dismissedByRole`. Nothing in that PR wrote `dismissedByRole`. The field was read and never written. PR #4 is the writer: `triageBacklog` increments `session.dismissedByRole[role]` in `harness/lib/panel/backlog.mjs` when a finding is discarded. A-40 in `harness/lib/panel/backlog-triage.test.mjs` is the test that shows the rate.

## Bypass check

This spec did not add the state-file protection. The approval record it relied on could be written by the agent. That hole is closed in `specs/close-the-gaps/`, not here. The shell route, the state-file route, and the flag route for that protection are tested in `harness/lib/enforce/state-protect.test.mjs` (A-49, A-50, A-52).

## Known gaps and rerun commands

The false-positive metric (dismissed rate) was never written before PR #4. Reporting A-01 through A-34 green at the course-alignment merge did not make that counter real.

`npm test`

acceptance-checker: PASS
