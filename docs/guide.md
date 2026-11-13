# Using the harness

Same steps for Cursor and Claude Code. `./verify.sh` is the only entry point. Flags pick the action. Configuration lives in yaml, and no flag takes a value.

A green command exits 0. Exit 1 means the code under check failed. Exit 2 means the harness itself is wrong (missing tool, bad config, unknown flag). Do not retry an exit 2 as if it were a test failure.

## 1. Prerequisites

Node 20 or newer (`engines` in `package.json` says `>=20`), npm, and git. This repo's CI uses Node 24.

```bash
node --version
npm --version
git --version
```

A success looks like `v20.11.0` or newer, an npm version line, and a git version line.

Optional tools. The sensors that need them are skipped when the binary is missing and `missing` is `skip`:

- gitleaks, for `secrets`
- semgrep, for `sast` (it also needs a network path to semgrep.dev)
- the binaries named in `harness/sensors/guidance/` for `env-declared`, `boundaries`, `contracts`, and `deadcode`

## 2. Install into a repo

From the repo root:

```bash
npm install
./verify.sh --install
```

On a terminal it asks `Which tool? (cursor | claude):` when `harness.local.yaml` has no `tool`. It then asks `CODEOWNERS owner for <glob>? (empty skips)` for each protected glob, and waits on `Press Enter to continue`.

It writes `harness.yaml` when the shared file is missing, `harness.local.yaml` with the tool you picked, an `AGENTS.md` block, `CLAUDE.md` pointing at it, a git pre-commit hook, and the adapter under `.cursor/` or `.claude/`. If `.github/CODEOWNERS` already exists it is left as it is. A new file is written only from the owners you typed.

Success ends with `Non-interactive: install finished without waiting.` when there is no terminal, or returns to the prompt after Enter. The last lines include `CODEOWNERS uncovered:` and either a glob list or `(none)`.

`--install` is one of the three commands this guide does not ask you to re-run from a fixture. `./verify.sh --help` lists it.

## 3. Pick your tool and render

`harness.local.yaml` holds the one tool. Copy the example if install did not write it:

```bash
cp harness.local.yaml.example harness.local.yaml
```

Set `tool: cursor` or `tool: claude`. Then:

```bash
./verify.sh --render
```

Success prints `rendered cursor adapter` or `rendered claude adapter`, and stderr lists `enforcement: on` plus the wired events.

```bash
./verify.sh --render --check
```

Success prints `render check ok (cursor)` or `render check ok (claude)`. Drift exits 1 and names the file.

```bash
./verify.sh --status
```

Success starts with `enforcement: on`, then `tool: cursor · profile: default` (or `claude`), then `env: local (HARNESS_ENV)`. CI-only sensors are on the `CI-only:` line. `protected-change` is one of them.

## 4. First check run

```bash
./verify.sh --edit
```

Edit tier. Format, lint, and the context budget. A clean tree prints a line like `pass tier=edit env=local treeHash=ab12cd34 (40ms)` or `no-changes tier=edit env=local treeHash=ab12cd34 (40ms)`, and exits 0.

```bash
./verify.sh --turn
```

Turn tier adds the reviewer when the diff needs it. Same shape of line, with `tier=turn`.

```bash
./verify.sh
```

No flag is the commit tier. The same line uses `tier=commit`.

Read `harness/state/report.json` for the check list and `harness/state/review.md` when a panel ran. Exit 0 is green. Exit 1 is a failing check. Exit 2 is a harness problem. The text of an exit 2 starts with the missing setting or `Unknown flag(s):`.

## 5. Write a PRD

Use the `write-a-prd` skill. It asks what the change is for, then writes `specs/<slug>/PRD.md` and `specs/<slug>/acceptance.json`. Each entry has an id, `passes: false`, and a test path. Do not mark an entry passing until that test is green.

## 6. Plan and loop

`harness.yaml` or `harness.local.yaml` needs `loop.prd` pointing at the PRD, plus `maxTurns`.

```bash
./verify.sh --plan
```

On a terminal it shows the model assignment and asks you to confirm. Success prints `Plan written to harness/state/plan.json. Nothing implemented until --loop.` Cancel prints `Plan cancelled.`

```bash
./verify.sh --loop
```

The loop implements a unit, runs the turn tier, then the panel, until the plan is done or a budget stops it (`maxTurns`, `maxSeconds`, `maxCostUsd`). Work stays staged. A file named `STOP` in the repo root stops the loop. The message is `stopped by STOP file`.

```bash
./verify.sh --resume
```

Continues a paused loop. With no plan it prints `nothing-to-do: empty plan` and exits 0.

`--loop` is not re-run from a fixture in the doc check. `./verify.sh --help` lists it.

## 7. Review

The panel is the reviewer, and on the right tier security, product, and the other roles in `harness/roles/README.md`. Checker subagents are `acceptance-checker` and `integrity-checker`. They return a category. `harness.yaml` maps that category to P0, P1, P2, or P3.

A unit that touches `review.humanRequired.paths` becomes `needs-human`. The panel cannot clear it.

The trust ladder is shadow, then advisory, then blocking. A role starts where its check is weak and moves up only after the findings stay useful. The ladder does not approve a protected file. CI `protected-change` does that.

## 8. Backlog triage

```bash
./verify.sh --backlog
```

On a terminal, each open finding asks `keep, discard, or promote?`. Keep leaves it open. Discard increments that role's dismissed count on the session, which `--report` prints. Promote writes a stub spec and marks the finding promoted. Without a terminal the same list is printed and nothing is changed. Exit 0.

## 9. Changing a check

A protected path (`protect.checkPaths` in `harness.yaml`, including `protect.shipCommands`) needs a local record first.

```bash
./verify.sh --allow-check-edit
```

Run that from your own terminal. It asks for the paths and a one-line reason, writes the session record, and appends a hash to `harness/state/check-edits.log`. The agent is refused if it tries. The record is an early warning. CI still decides.

Then open the pull request. A code owner approves the head commit, or, when you are the only owner, you add `protected-change-approved` after the push. A later push clears the label.

`--allow-check-edit` is not re-run from a fixture in the doc check. `./verify.sh --help` lists it.

## 10. Shipping

The ship gate refuses these unless you gave an explicit instruction in this session:

- `git commit` and `git push`
- `gh pr create`
- `gh pr edit` with `--add-label` or `--remove-label`
- `gh pr review` with `--approve`
- `gh pr merge`
- `gh label`
- `gh api` whose path contains `/labels`, `/reviews`, or `/merge`

`gh pr view` and `gh pr checks` stay allowed. You open the pull request yourself after you have said to ship. The hook's reason names the ship gate.

## 11. After the run

```bash
./verify.sh --report
```

Prints the session cost and the review metrics (dismissed and promoted counts). Exit 0, including when there is no session yet.

A finished wave writes a retro under `harness/retro/`. Durable notes go in `HANDOFF.md`, not under `harness/state/`.

## 12. Finishing a spec

Use the `report-against-prd` skill. Write `specs/<slug>/REPORT.md` with criteria, wiring proof, bypass check, and known gaps. `report-present` reads every id in the PRD. Each one must be passing in `acceptance.json` and listed in the report's criteria table. The report ends with `acceptance-checker: PASS`.

An id is out of scope only with a line in the PRD:

```text
Deferred: A-12 (reason)
```

Remove that line and the id is required again.

## 13. When a bug escapes

Use the `fix-an-escape` skill. Interview first, add a regression test, then fix the code. Do not start with the patch.

## 14. Troubleshooting

Rows from `docs/loop-failure-modes.md`.

| What you see                                | What it means                                                                                            | What to do                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Exit 2, and the text names a missing tool   | The sensor's binary is not on `PATH` and `missing` is `exit2`                                            | Install the tool. Do not retry the same command as a code failure.                                                    |
| `sast` fails with no network                | semgrep cannot reach semgrep.dev                                                                         | Record it as a local gap. CI runs the same sensor with network.                                                       |
| `check-integrity` refuses your own edit     | The diff touches a protected path and the session has no live record, or the hash does not match the log | Run `./verify.sh --allow-check-edit` from your terminal, then edit.                                                   |
| `protected-change` is red on a pull request | The head has no owner review on that SHA, or the solo label is missing or stale                          | An owner approves the head commit, or the sole owner adds `protected-change-approved` after the latest push.          |
| The label disappears after a push           | `synchronize` clears `protected-change-approved`, and a label older than `updated_at` does not count     | Add the label again after the push. `verify` waits for the clear job, so a stale label cannot approve the new commit. |

Help and version, if you need the flag list:

```bash
./verify.sh --help
./verify.sh -h
./verify.sh --version
./verify.sh -v
```

`--help` and `-h` print the usage text and exit 0. `--version` and `-v` print `0.1.0` and exit 0.

```bash
./verify.sh --hook
```

Hooks call this with a JSON payload on stdin and `HARNESS_IN_HOOK=1`. An empty payload fail-opens: it prints a JSON object with `"failOpen": true` and exits 0, so the editor is not stuck.
