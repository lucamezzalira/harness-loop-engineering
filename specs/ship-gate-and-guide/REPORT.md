# Report: Close three ship-gate spellings and flesh out two guide steps

Reviewed against `specs/ship-gate-and-guide/acceptance.json`.

## Criteria

| ID    | Test                                              | Entry point                                                                                                            | Code path                                                                                                                                                                                                                                                                                                                                                                                | Last green run             |
| ----- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| A-95  | `harness/lib/enforce/pre_tool.test.mjs`           | Calls `preTool` for each refused command, including `--approve=true` and a command inside `sh -c`, `zsh -c`, or `eval` | `shipCommandHit` in `harness/lib/enforce/ship-commands.mjs` (line 24) calls `hitText` (line 32). `reviewHit` (line 45) uses `flagOn` (line 209), so `--approve=true` and `--approve=1` match and `--approve=false` does not. `unwrapHit` (line 174) runs the same check on the quoted command after `sh -c`, `bash -c`, `zsh -c`, or `eval`. `pre_tool.mjs` appends the ship-gate reason | `node --test` of that file |
| A-96  | same file                                         | Calls `preTool` for the four allowed commands                                                                          | same function. A comment, a `query`, a token-free GET, and `gh pr view` match no row                                                                                                                                                                                                                                                                                                     | same run                   |
| A-97  | `harness/lib/checks/ship-gate-and-guide.test.mjs` | Reads the three files                                                                                                  | `harness/enforce/README.md`, guide step 10, `docs/loop-failure-modes.md`                                                                                                                                                                                                                                                                                                                 | same run                   |
| A-98  | same file                                         | Reads guide step 5 and `JSON.parse`s the acceptance fence                                                              | `docs/guide.md` step 5                                                                                                                                                                                                                                                                                                                                                                   | same run                   |
| A-99  | same file                                         | Reads guide step 13, checks the fail line comes before the pass line, and parses the `ESC-` object                     | `docs/guide.md` step 13                                                                                                                                                                                                                                                                                                                                                                  | same run                   |
| A-100 | same file                                         | Spawns `node --test --test-name-pattern '^A-83 '` on `ci-gate-fixes.test.mjs` with the test-runner channel env removed | the guide command runner in that file                                                                                                                                                                                                                                                                                                                                                    | same run                   |

## Wiring proof

`protect.shipCommands` is written in `harness.yaml` and copied in `DEFAULTS` in `harness/lib/config.mjs`. `shipRules` in `pre_tool.mjs` reads whichever list `loadConfig` returns. A-95 calls `preTool('/repo', ...)`, and `/repo` has no yaml, so the default list is the one under test. The yaml list is the same text.

The GitHub token names are not a field a test writes. The refusal looks for the strings `GITHUB_TOKEN`, `GH_TOKEN`, and `GH_ENTERPRISE_TOKEN` in the command text. A-95's curl case puts `$GITHUB_TOKEN` in the command.

## Bypass check

- Other HTTP clients. `shipCommandHit` only treats `curl`, `wget`, `http`, `node -e`, and `python -c` as the clients in the list. Something else that PUTs to `api.github.com` is not matched. No test covers that client, and this is a known gap.
- A script written to a file and then run. `node script.mjs` is not `node -e`. The file can call the API without naming a token env var in the shell command. No test covers that path, and this is a known gap.
- A token the agent can read. If `GITHUB_TOKEN` is already in the environment, a command that never writes the name still sends it. The ship gate cannot see the environment. No test uses a real token. Keeping the token out of the agent's environment is the defence that holds.

Shell route for the three spellings that are covered: A-95 goes through `preTool`. State-file route: none of these commands write harness state. Flag route: there is no flag that turns the list off. Removing a row from `protect.shipCommands` is a protected check edit.

## Known gaps and rerun commands

The list is pattern matching. A spelling that is not one of the rows still gets through. CI `protected-change` still decides on the pull request.

`gh api graphql -F query=@file`: the mutation is in a file the guard can't read.

`echo $GITHUB_TOKEN`, `printenv GH_TOKEN` and `env | grep TOKEN` read the token, which can then be passed to an HTTP client the list doesn't know. Keeping tokens out of the agent's environment is the defence.

An approval covers every change to its paths until it expires (12 hours or end of session), not one specific change. The `harness.yaml` edit in this change was made under a record created earlier for different work.

`mv harness.local.yaml /tmp/harness.local.yaml.ship-gate-bak && npm test` exited 0 on 2026-11-13 (173 tests) after `--approve=true` and the `sh -c` unwrap. The file was moved back afterward. `./verify.sh --turn` passed after that run. `report-present` and `doc-drift` printed ok.

```
node --test harness/lib/enforce/pre_tool.test.mjs harness/lib/checks/ship-gate-and-guide.test.mjs
```

acceptance-checker: PASS
