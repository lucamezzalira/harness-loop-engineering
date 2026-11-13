# Report: follow-up fixes after the course-alignment merge

Reviewed against `specs/followup-fixes/acceptance.json` (A-35 through A-48).

## Criteria

| ID           | Test                                            | Entry point                                                                                                                             | Code path                                                      | Last green run          |
| ------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------- |
| A-35 to A-39 | `harness/lib/enforce/allow-check-edit.test.mjs` | A-35 spawns the CLI with no TTY. A-36 and A-39 call `allowCheckEdit` with an injected TTY. A-37 and A-38 call `evaluateCheckIntegrity`. | `allowCheckEdit` in `harness/lib/enforce/allow-check-edit.mjs` | `npm test` on this tree |
| A-40, A-42   | `harness/lib/panel/backlog-triage.test.mjs`     | A-42 spawns the CLI `--backlog`. A-40 calls `triageBacklog`.                                                                            | `triageBacklog` in `harness/lib/panel/backlog.mjs`             | `npm test` on this tree |
| A-41         | `harness/lib/panel/outcomes.test.mjs`           | `runPanel` twice                                                                                                                        | `reconcileFindings` in `harness/lib/panel/outcomes.mjs`        | `npm test` on this tree |
| A-43         | `harness/lib/plan/loop-human.test.mjs`          | `runLoop`                                                                                                                               | `applyHumanGate` in `harness/lib/plan/loop.mjs`                | `npm test` on this tree |
| A-44, A-45   | `harness/lib/cli-status.test.mjs`               | A-44 spawns `--status`                                                                                                                  | `harness/lib/cli.mjs`                                          | `npm test` on this tree |
| A-46, A-48   | `harness/lib/checks/course-gates.test.mjs`      | Spawns the sensor scripts and the CLI                                                                                                   | `harness/sensors/checks/`                                      | `npm test` on this tree |
| A-47         | `harness/lib/checks/stryker-survivor.test.mjs`  | Runs Stryker, then `runChecks`                                                                                                          | `harness/lib/checks/mutation-survivors.mjs`                    | `npm test` on this tree |

## Wiring proof

`explicitCheckEdit` is written by `allowCheckEdit` and read by `pathCoveredByRecord` in `harness/lib/checks/check-integrity.mjs` and by `preTool` in `harness/lib/enforce/pre_tool.mjs`. `dismissedByRole` is written in `triageBacklog` and read in `harness/lib/accounting-review.mjs`.

## Bypass check

At the time of PR #4 the approval record could be self-written. Three routes had no block:

- Shell route: `echo x > harness/state/session.json`, `tee`, `cp`, `node -e`.
- State-file route: a Write tool call on `harness/state/session.json`.
- Flag route: the agent running `./verify.sh --allow-check-edit` when the shell was a real terminal.

Those routes are blocked by this later PRD. The tests are A-49, A-50, and A-52 in `harness/lib/enforce/state-protect.test.mjs`. A hash mismatch is `check-weakened` (A-51).

## Known gaps and rerun commands

PR #4 reported A-35 through A-48 green. The record those tests authorised could still be written by the agent. That is the hole `specs/close-the-gaps/` closes. A person at the developer's own terminal can still approve. That is accepted.

`npm test`

acceptance-checker: PASS
