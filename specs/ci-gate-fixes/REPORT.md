# Report: Fix the CI gate and finish the docs

Reviewed against `specs/ci-gate-fixes/acceptance.json`.

## Criteria

| ID   | Test                                           | Entry point                                                                                                            | Code path                                                                               | Last green run |
| ---- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------- |
| A-84 | `harness/lib/checks/ci-gate-fixes.test.mjs`    | Reads every `*.test.mjs` and fails on a `cli.mjs` or `verify.sh` spawn with `cwd: ROOT`. It does not spawn `npm test`. | the test itself                                                                         | this change    |
| A-85 | same file                                      | Parses `.github/workflows/ci.yml`                                                                                      | the `Unit tests (no local config)` step                                                 | this change    |
| A-86 | same file                                      | Parses the verify job                                                                                                  | `needs` and `if` on `verify`                                                            | this change    |
| A-87 | `harness/lib/checks/protected-change.test.mjs` | Spawns `harness/sensors/checks/protected-change.sh` twice against an in-process mock                                   | `labelApprover` and `synchronizeCutoff` in `protected-change.mjs` (lines 103 and 125)   | this change    |
| A-88 | `harness/lib/enforce/pre_tool.test.mjs`        | Calls `preTool` for each refused command                                                                               | `shipCommandHit` in `ship-commands.mjs` (line 12), called from `pre_tool.mjs` (line 75) | this change    |
| A-89 | same file                                      | Calls `preTool` for `gh pr view` and `gh pr checks`                                                                    | same function. Those commands match no rule                                             | this change    |
| A-90 | `harness/lib/checks/ci-gate-fixes.test.mjs`    | Reads `.github/CODEOWNERS`                                                                                             | the file order                                                                          | this change    |
| A-91 | same file                                      | Spawns `codeowners-coverage.mjs` on a fixture and on this tree                                                         | `broadOverrides` in `codeowners.mjs` (line 93), printed by `codeowners-coverage.mjs`    | this change    |
| A-92 | same file                                      | Spawns `report-present.mjs` on a fixture whose PRD names six ids and whose acceptance file has four                    | `requiredIds` and `specFindings` in `report-present.mjs` (lines 73 and 28)              | this change    |
| A-93 | same file                                      | Spawns the same script after adding two Deferred lines, then removes one                                               | the deferred-line match in `requiredIds`                                                | this change    |
| A-94 | same file                                      | Spawns `report-present.mjs` with `HARNESS_ROOT` set to this tree and reads the gate spec's acceptance file             | `evaluateReportPresent` (line 15)                                                       | this change    |

## Wiring proof

`protect.shipCommands` is written in `harness.yaml` and in `DEFAULTS` in `harness/lib/config.mjs`. `shipRules` in `pre_tool.mjs` reads it. A-88 calls `preTool` with root `/repo`, which has no yaml, so the default list is the one under test. The yaml list is the same text, and editing it is already a protected path because `harness.yaml` is on `protect.checkPaths`.

`pull_request.updated_at` is read by `synchronizeCutoff` from the event file GitHub writes to `GITHUB_EVENT_PATH`. The test writes that file. There is no other writer in this repo. On a real pull request, GitHub writes it.

`needs` and `if` on the verify job are written in `.github/workflows/ci.yml`. A-86 reads them. The clear job still runs `clear-protected-label.mjs`, which deletes the label. A-87 is the case where the delete has not happened yet.

## Bypass check

- Stale label after a push, including the race: A-87. The label is still on the issue, the only `labeled` event is before `updated_at`, and the sensor exits 1. Adding the label after `updated_at` exits 0. A-86 keeps `verify` behind the job that deletes the label, including when that job is skipped (`if: always()`).
- Review on an old commit: still A-66 in the gate spec. `commit_id` must equal the head SHA. This change does not weaken that test.
- Label by a non-owner: still A-68. `labelApprover` returns empty when the actor is not in CODEOWNERS. The timestamp check runs first and does not grant that actor a pass.
- Direct push to main: still A-71. A protected push to the default branch with no pull request fails. A feature-branch push stays skipped.
- Agent using `gh` for label, review, or merge: A-88. Each command is refused and the reason matches `ship gate`. A-89 is the read-only pair that stays allowed.
- Agent using the developer's token directly: known limit. A call that never goes through `pre_tool` looks like the developer to GitHub. No test uses a real token. ADR 0007 states the limit.

## Known gaps and rerun commands

Branch protection is off. A red `protected-change` warns and does not stop a merge. The README says how to require the check, and marks that step optional.

Cursor still has no before-write hook. A Write of `harness/state/session.json` never reaches `pathUnderState`.

`mv harness.local.yaml /tmp/harness.local.yaml.ci-gate-bak && npm test` exited 0 on 2026-11-13 (167 tests). The file was moved back afterward. `./verify.sh --turn` exited 0. `./verify.sh` (commit tier) exited 0. `sast` is `where: [ci]`, so it did not run locally. It is deferred to CI, where a failure to reach semgrep.dev would still fail that sensor.

```
node --test harness/lib/checks/ci-gate-fixes.test.mjs harness/lib/checks/protected-change.test.mjs harness/lib/enforce/pre_tool.test.mjs
```

acceptance-checker: PASS
