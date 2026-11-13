# Report: CI gate for protected changes, Part A

Reviewed against `specs/ci-is-the-gate/acceptance.json` (A-64 through A-77). Part B (A-78 through A-83) is not started. This file does not close the PRD.

## Criteria

| ID   | Test                                              | Entry point                                                                                                                                                                                                                                                                          | Code path                                                                                                                                                                 | Last green run                           |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| A-64 | `harness/lib/checks/protected-change.test.mjs`    | Spawns `harness/sensors/checks/protected-change.sh`, then a child that calls `runChecks` so `report.protectedChange` is the file the sensor wrote                                                                                                                                    | `evaluateProtectedChange` in `harness/lib/checks/protected-change.mjs` (line 218); `attachProtectedChange` in `harness/lib/checks/runner.mjs` (line 213)                  | `node --test` of this file on 2026-11-13 |
| A-65 | same file                                         | Spawns the sensor script. The author's review fails. An owner review on the head SHA passes                                                                                                                                                                                          | `reviewApprover` in `protected-change.mjs`                                                                                                                                | same run                                 |
| A-66 | same file                                         | Spawns the sensor script. A review whose `commit_id` is the base SHA fails. The head SHA passes                                                                                                                                                                                      | `reviewApprover`                                                                                                                                                          | same run                                 |
| A-67 | same file                                         | Spawns the sensor script, then `node harness/lib/checks/clear-protected-label.mjs`, then the sensor again. The committer date is 2099 and the label `created_at` is 2020. A second test copies that script and `github-api.mjs` into a directory with no `node_modules` and runs it. | `labelApprover` in `protected-change.mjs`; `clearProtectedLabel` in `clear-protected-label.mjs` (line 5), which imports only `github-api.mjs`                             | same run                                 |
| A-68 | same file                                         | Spawns the sensor script. The label actor is not in CODEOWNERS                                                                                                                                                                                                                       | `labelApprover`                                                                                                                                                           | same run                                 |
| A-69 | same file                                         | Spawns the sensor script on `notes/schema.sql` containing `DROP TABLE`                                                                                                                                                                                                               | `patternHits` in `harness/lib/review/human-required.mjs`, called from `rulesForFile`                                                                                      | same run                                 |
| A-70 | same file                                         | Spawns the sensor script and asserts the mock saw no `/reviews` or `/timeline` call                                                                                                                                                                                                  | `evaluatePull` returns before `github()` when the protected set is empty                                                                                                  | same run                                 |
| A-71 | same file                                         | Spawns the sensor script for a default-branch push and a feature-branch push. The feature push sets `GITHUB_TOKEN` to empty and still exits 0                                                                                                                                        | `evaluateProtectedChange` skip branch, then `evaluatePush`                                                                                                                | same run                                 |
| A-72 | same file                                         | Spawns the sensor script with an empty token, then against a mock that returns 500 for reviews                                                                                                                                                                                       | `github()` in `protected-change.mjs`                                                                                                                                      | same run                                 |
| A-73 | `harness/lib/checks/codeowners-coverage.test.mjs` | Reads `.github/CODEOWNERS` and spawns `harness/sensors/checks/codeowners-coverage.sh` on this tree                                                                                                                                                                                   | `globsToCover` in `harness/lib/checks/codeowners.mjs`; `evaluateCodeownersCoverage` (line 6)                                                                              | same `node --test` run                   |
| A-74 | same file                                         | Spawns the sensor script on a fixture with one uncovered glob, then on this tree                                                                                                                                                                                                     | `uncoveredGlobs`                                                                                                                                                          | same run                                 |
| A-75 | same file                                         | Spawns `node harness/lib/cli.mjs --install` with `HARNESS_ROOT` set to a fixture that already has CODEOWNERS                                                                                                                                                                         | `offerCodeowners` in `harness/lib/install.mjs` (line 171)                                                                                                                 | same run                                 |
| A-76 | `harness/lib/checks/check-integrity.test.mjs`     | Spawns `node harness/lib/checks/check-integrity.mjs` on a fixture whose live record covers the dirty `harness.yaml`                                                                                                                                                                  | `evaluateCheckIntegrity` (line 66) prints the line at line 218                                                                                                            | same run                                 |
| A-77 | same file                                         | Runs `grep -R -i -F` over `harness/` and `docs/` for the five phrases listed in the test. The test file itself is excluded, because that is where the phrases are listed                                                                                                             | wording in `pre_tool.mjs`, `allow-check-edit.mjs`, `check-integrity.md`, `harness/enforce/README.md`, both `HOOKS.md` files, `docs/loop-failure-modes.md`, and the README | same run                                 |

## Wiring proof

`GITHUB_TOKEN` is written by the verify job and the label job in `.github/workflows/ci.yml` (`github.token` in the environment, not a flag). `github()` in `protected-change.mjs` reads it. A missing token throws before any pass. Tests set the same variable.

`GITHUB_EVENT_NAME` and `GITHUB_EVENT_PATH` are set by GitHub Actions for the workflow events. `readGithubEvent` reads the file. The workflow subscribes to `pull_request` (`opened`, `synchronize`, `reopened`, `labeled`, `unlabeled`) and `pull_request_review` (`submitted`, `dismissed`).

The sensor writes `harness/state/protected-change.json` from `writeBody` (line 232). `attachProtectedChange` copies that file onto `report.protectedChange` only when a check named `protected-change` ran. A-64 asserts the attached file and status.

`.github/CODEOWNERS` is the committed owner list. `readCodeowners` reads it. `offerCodeowners` writes it only when the file is absent. A-75 keeps an existing file byte-identical.

The label `protected-change-approved` is added by a person on GitHub. `labelApprover` reads the current labels and the issue timeline. `clearProtectedLabel` deletes it on `pull_request` `synchronize`. The clear job is the only step with `issues: write`. It checks out the repo and runs the script. It does not `npm install`. `clear-protected-label.mjs` imports `github-api.mjs`, and that file uses only Node built-ins, so the `yaml` package is not loaded. The verify job has `contents: read`, `pull-requests: read`, and `issues: read`.

`explicitCheckEdit` is still written by `allowCheckEdit` and read by `evaluateCheckIntegrity`. `localApproval` is computed there and printed. It is not stored.

`sensors.yaml` sets `protected-change` to `where: [ci]`. `--status` reads that and prints the CI-only line (`cli.mjs` line 260). A-64 asserts the line.

## Bypass check

- Review on an older commit: A-66. `commit_id` must equal the head SHA.
- Label added before the next push: A-67. The test runs `clear-protected-label.mjs` on a `synchronize` event, sees the DELETE, and the sensor then fails until the label is added again. The committer date is 2099 and the label time is 2020, and the first pass still succeeds, so the date is not the check.
- Label added by someone who is not in CODEOWNERS: A-68.
- Direct push to the default branch with protected changes and no pull request: A-71. A feature-branch push is `skipped (no pull request)` and exits 0 even with an empty token.
- The author's own `APPROVED` review: A-65. It does not count.
- Missing token or an API error: A-72. Both exit 2.
- Shell route: there is no flag that runs or skips this sensor locally. `where: [ci]` defers it. The existing where-filter test in `runner.test.mjs` covers that deferral. A-64 checks `--status`.
- State-file route: `attachProtectedChange` copies `protected-change.json` only after the check has run. The sensor overwrites that file on each run. A-64 goes through `runChecks`.
- Flag route: `--allow-check-edit` still records a local early warning. A-76 asserts the pass prints `local approval only; CI protected-change decides on the pull request`.
- Agent using the developer's GitHub token: not covered in Part A. Part B adds the `gh pr edit` and label refusals (A-80). Until then, a token in the agent's environment can add the label. That is an open gap.

## Known gaps and rerun commands

Part B is not started. There is no ADR 0007, no `docs/guide.md`, no trust-model section, and no ship-gate refusal for `gh pr edit` or label commands.

GitHub branch protection is out of scope. A red `protected-change` warns and does not stop a merge. The sensor guidance says so.

Cursor still has no before-write hook. A Write of `harness/state/session.json` does not reach the local guard. That limit is unchanged from the previous PRD.

`npm test` is green. `./verify.sh --turn` exited 0. The skipped sensors are the ones whose tools are not installed: env-declared, boundaries, contracts, deadcode. `codeowners-coverage` and `doc-drift` both printed ok on this tree with `HARNESS_ROOT` set. Commit-tier `./verify.sh` has not been run. SAST was not run.

```
node --test harness/lib/checks/protected-change.test.mjs harness/lib/checks/codeowners-coverage.test.mjs harness/lib/checks/check-integrity.test.mjs
HARNESS_ROOT="$PWD" bash harness/sensors/checks/codeowners-coverage.sh
HARNESS_ROOT="$PWD" bash harness/sensors/checks/doc-drift.sh
```

acceptance-checker: PASS
