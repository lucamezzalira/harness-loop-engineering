# Report: close the self-authorisation hole

Reviewed against `specs/close-the-gaps/PRD.md` and `acceptance.json` (A-49 through A-63).

## Criteria

| ID   | Test                          | Entry point                                                                       | Code path                                                                                            | Last green run          |
| ---- | ----------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- |
| A-49 | `state-protect.test.mjs`      | `node harness/lib/cli.mjs --hook` with Write, Edit, StrReplace, MultiEdit, Delete | `preTool` calls `pathUnderState` at `harness/lib/enforce/pre_tool.mjs` line 87                       | `npm test` on this tree |
| A-50 | `state-protect.test.mjs`      | `--hook` with `beforeShellExecution`                                              | `shellStateRefusal` from `pre_tool.mjs` line 46, matchers in `state-guard.mjs`                       | `npm test` on this tree |
| A-51 | `state-protect.test.mjs`      | Spawns `harness/lib/checks/check-integrity.mjs`                                   | `recordMatchesLog` in `check-edit-record.mjs` line 62. Finding at `check-integrity.mjs` line 83      | `npm test` on this tree |
| A-52 | `state-protect.test.mjs`      | CLI `--allow-check-edit` once per marker                                          | `agentMarkerSet` in `allow-check-edit.mjs` line 46, refusal in `allowCheckEdit` line 76              | `npm test` on this tree |
| A-53 | `state-protect.test.mjs`      | `node harness/lib/cli.mjs --loop` on a one-unit plan                              | `runLoop` writes the session, `runChecks` writes the report, `writeFinishedWave` writes the retro    | `npm test` on this tree |
| A-54 | `state-protect.test.mjs`      | CLI `--allow-check-edit` on a pty                                                 | `newAdhocSession` in `adhoc-session.mjs` line 11, called from `allowCheckEdit` line 111              | `npm test` on this tree |
| A-55 | `state-protect.test.mjs`      | CLI `--allow-check-edit` and CLI `--backlog`, each on a pty                       | `backlog.mjs` line 143 and `allow-check-edit.mjs` line 111, both through `cli.mjs`                   | `npm test` on this tree |
| A-56 | `acceptance-checker.test.mjs` | Reads the skill file                                                              | `harness/skills/report-against-prd/SKILL.md`                                                         | `npm test` on this tree |
| A-57 | `acceptance-checker.test.mjs` | `invokeRole` with the real role file and `HARNESS_FAKE_PROVIDER=1`                | `acceptanceVerdict` in `fake-provider.mjs` line 130. Duties in `harness/roles/acceptance-checker.md` | `npm test` on this tree |
| A-58 | `report-present.test.mjs`     | Spawns `report-present.mjs`                                                       | `evaluateReportPresent` in `report-present.mjs` line 11                                              | `npm test` on this tree |
| A-59 | `report-present.test.mjs`     | Spawns `report-present.mjs` on this repo                                          | Same function. The three `REPORT.md` files                                                           | `npm test` on this tree |
| A-60 | `doc-drift.test.mjs`          | Spawns `doc-drift.mjs` on six fixtures and on this repo                           | `evaluateDocDrift` in `doc-drift.mjs` line 15                                                        | `npm test` on this tree |
| A-61 | `doc-drift.test.mjs`          | Search `docs` for the retired host name                                           | Allowlist `docs/adr/0001`, `0004`, `0006`                                                            | `npm test` on this tree |
| A-62 | `doc-drift.test.mjs`          | Reads `AGENTS.md` and runs `context-budget.sh`                                    | Boundary lines in `AGENTS.md`. Limit `limits.agentsMdLines` in `harness.yaml`                        | `npm test` on this tree |
| A-63 | `doc-drift.test.mjs`          | Reads the README `What changed` section                                           | `README.md`                                                                                          | `npm test` on this tree |

## Wiring proof

| Read                                                                   | Writer                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `session.explicitCheckEdit`                                            | `allowCheckEdit` writes it after `newAdhocSession`                                   |
| sha256 on the last `check-edits.log` line                              | `appendCheckEditLog` via `checkEditLogLine` / `hashRecord`                           |
| `protect.stateWrites` and `protect.stateDir`                           | `harness.yaml` `protect`, also the defaults in `harness/lib/config.mjs`              |
| `session.tool`, `session.profile`, `session.env` on a fallback session | `newAdhocSession` from `loadConfig` and `resolveHarnessEnv`                          |
| Agent markers                                                          | The process environment. The names are `AGENT_ENV_MARKERS` in `allow-check-edit.mjs` |
| `acceptance-checker: PASS`                                             | The acceptance checker appends it to `REPORT.md`                                     |

No new flag was added. `--allow-check-edit` already existed. Its refusal now also reads the marker list.

## Bypass check

State writes and the approval flag:

| Route                                                                                           | Block                                    | Test                                                    |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| Shell (`>`, `tee`, `cp`, `mv`, `rm`, `truncate`, `sed -i`, `node -e`, `python -c`)              | `shellStateRefusal`                      | A-50, through `--hook`                                  |
| State file, when the host sends Write, Edit, StrReplace, MultiEdit, or Delete                   | `pathUnderState` in `preTool`            | A-49, through `--hook`. Cursor has no before-write hook |
| Flag (`--allow-check-edit` in a shell command, or the CLI with a marker or `HARNESS_IN_HOOK=1`) | `shellStateRefusal` and `allowCheckEdit` | A-50 and A-52                                           |

A hand edit of the record that leaves the log behind is not accepted. `check-integrity` reports `check-weakened` (A-51).

## Known gaps and rerun commands

Cursor documents `CURSOR_AGENT` for agent terminal sessions (`https://cursor.com/docs/agent/tools/terminal`). It does not document a marker for hooks or MCP servers. Hooks still set `HARNESS_IN_HOOK=1`, and that refuses the flag. There is no second Cursor variable to guess.

Cursor's adapter has `beforeShellExecution` and `afterFileEdit`. It has no before-write hook, so a Write or Edit of `harness/state/session.json` in Cursor never reaches `pathUnderState`. `afterFileEdit` cannot refuse. The shell route still covers redirects and `node -e` on Cursor, because those go through `beforeShellExecution`. Claude Code `PreToolUse` does send the write, and A-49 covers that payload.

Claude Code documents `CLAUDECODE` and `CLAUDE_CODE_CHILD_SESSION` (`https://code.claude.com/docs/en/env-vars`). The IDE also sets `CLAUDECODE` in an integrated terminal, so a person typing there is refused too. That is the documented signal.

A person at the developer's own terminal, with none of those markers set, can still approve a check edit and can still write `harness/state/` from that terminal. The hash does not stop someone who rewrites both the session file and the log. The tests do not cover that attacker.

`./verify.sh --turn` on this dirty tree fails `check-integrity` until the developer runs `./verify.sh --allow-check-edit` in their own terminal. That refusal is the feature. `npm test` is the acceptance evidence.

Skipped sensors when their tools are missing stay skipped: `env-declared`, `boundaries`, `contracts`, and the commit tools that are not installed locally.

```
npm test
node harness/lib/checks/report-present.mjs
node harness/lib/checks/doc-drift.mjs
grep -ri the retired host name docs
```

acceptance-checker: PASS
