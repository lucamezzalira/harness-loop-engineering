# Report: platform gates

Reviewed against `specs/platform-gates/acceptance.json` (A-101 through A-119).

## Criteria

| ID    | Test                                           | Entry point                                                                                                                                                                          | Code path                                                                                                                                           | Last green run                           |
| ----- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| A-101 | `harness/lib/checks/protected-change.test.mjs` | Parses `.github/workflows/protected-change.yml` and walks the import graph of `protected-change.mjs` and `clear-protected-label.mjs`                                                 | workflow trigger at line 14; checkout `ref` at line 51; fetch at line 54; sensor job permissions at line 42                                         | `node --test` of this file on 2026-11-16 |
| A-102 | same file                                      | Builds a fixture repo, checks out the base, and spawns `harness/sensors/checks/protected-change.sh`. The head commit's `protected-change.mjs` is `process.exit(0)` plus `DROP TABLE` | `evaluateProtectedChange` reads `sensorConfig` from the working tree and diffs `base...head`                                                        | same run                                 |
| A-103 | same file                                      | Same entry point. The head `harness.yaml` drops `DROP\s+TABLE`. The working tree stays on the base commit                                                                            | `listsFromHarnessYaml`                                                                                                                              | same run                                 |
| A-104 | same file                                      | Reads `ci.yml` and spawns `node harness/lib/cli.mjs --status` with `HARNESS_ROOT` set to this tree. The cwd is a temp directory                                                      | `baseBranchWorkflowNames` in `harness/lib/cli.mjs`, printed from `main`. `sensors.yaml` sets `tier: manual`                                         | same run                                 |
| A-105 | `harness/lib/checks/platform-rules.test.mjs`   | Spawns `harness/sensors/checks/platform-rules.sh` against a fixture `harness.yaml` and a mocked `GET /repos/acme/demo/rules/branches/main` that returns `[]`                         | `judge` in `platform-rules.mjs` (line 85). `warn` exits 0. `block` exits 1                                                                          | `node --test` of this file on 2026-11-16 |
| A-106 | same file                                      | Same script. The mocked `pull_request` parameters set `dismiss_stale_reviews_on_push` to false                                                                                       | `PULL_FIELDS` maps that name from the REST rules page. The line is `pull_request dismiss_stale_reviews_on_push is false`                            | same run                                 |
| A-107 | same file                                      | Same script, with a rules payload that matches `platform`                                                                                                                            | `BYPASS_LINE` (line 20) is the first line. The run does not say the bypass list is empty or safe                                                    | same run                                 |
| A-108 | same file                                      | Same script. The payload's only extra type is `not_a_documented_rule`                                                                                                                | `judge` prints `unknown not_a_documented_rule`. Mapped types are only `pull_request` and `required_status_checks`                                   | same run                                 |
| A-109 | same file                                      | Same script, once with `GITHUB_TOKEN` unset and once with the mock returning 500                                                                                                     | `github()` in `github-api.mjs` throws exit 2. The script's catch uses that code                                                                     | same run                                 |
| A-110 | `harness/lib/enforce/credentials.test.mjs`     | Spawns `node harness/lib/cli.mjs --hook` with `HARNESS_HOOK_MOMENT=sessionStart`, cwd a temp directory, and `GH_TOKEN` set to a value                                                | `collectCredentials` (line 28 of `credentials.mjs`). The hook prints it (cli.mjs line 370) and `recordCredentials` (line 48) writes `report.json`   | `node --test` of this file on 2026-11-16 |
| A-111 | same file                                      | Same hook. `PATH` starts with a fake `gh` whose `auth status` prints `account octocat`                                                                                               | `ghLogin` keeps the account name and drops the rest of the `gh` output                                                                              | same run                                 |
| A-112 | same file                                      | Same hook. The credential env names are unset, the fake `gh` exits 1, and the fixture has no `.env`                                                                                  | The text is `no known credentials visible` plus the line that names keychains and SSO caches                                                        | same run                                 |
| A-113 | same file                                      | Same hook, once with `GH_TOKEN` and once without                                                                                                                                     | cli.mjs line 380 is `process.exit(0)` on this moment. Both runs exit 0                                                                              | same run                                 |
| A-114 | `harness/lib/checks/platform-gates.test.mjs`   | Spawns `harness/lib/checks/doc-drift.mjs` on a fixture whose setting line has no URL                                                                                                 | `settingFindings` (line 238). A setting line is a list item that starts with a bold label. The URL has to be on that line                           | `node --test` of this file on 2026-11-16 |
| A-115 | same file                                      | Walks the repo and searches for the two old claims                                                                                                                                   | README turn-mode step 3 and the course-map row now say the hook is an early warning and the integrity check is decided in CI                        | same run                                 |
| A-116 | same file                                      | Parses the first table in `docs/loop-failure-modes.md`                                                                                                                               | The column is `Prevents or warns`. Hook and pattern rows are `warns`                                                                                | same run                                 |
| A-117 | same file                                      | Spawns `doc-drift.mjs` with `HARNESS_ROOT` set to this tree, cwd a temp directory, and reads the README                                                                              | `evaluateDocDrift` exits 0. The README review paragraph says the panel and any hosted AI reviewer are advisory and that their approval never counts | same run                                 |
| A-118 | `harness/lib/checks/protected-change.test.mjs` | Parses the workflow file and asserts `pull_request` and `pull_request_review` are absent                                                                                             | `on.pull_request_target` at line 14 of the workflow                                                                                                 | same protected-change run                |
| A-119 | same file                                      | Spawns the sensor script twice on a `notes/schema.sql` diff, then on a `harness.yaml` only diff                                                                                      | `labelApprover` and `decideFile`. The ruleset sentence is `RULESET_DECISION`                                                                        | same run                                 |

## Wiring proof

`GITHUB_EVENT_NAME` and `GITHUB_EVENT_PATH` are set by GitHub Actions. `readGithubEvent` reads the file. The protected-change workflow's event is `pull_request_target`. The events page lists that event's payload as `pull_request`, so `pull_request.base.sha`, `pull_request.head.sha`, `pull_request.number`, and `pull_request.updated_at` are fields GitHub writes. The workflow checks out `github.event.pull_request.base.sha` and fetches `refs/pull/<n>/head` as data. The sensor diffs the two SHAs inside the base checkout.

`GITHUB_TOKEN` is `github.token` on the sensor job and on the clear job. `github()` reads it. A missing token still exits 2 (A-72 and A-109).

`harness.yaml` writes `protect.checkPaths`, `review.humanRequired.paths`, `review.humanRequired.patterns`, and `platform`. `listsFromHarnessYaml` reads the three lists from the checkout. `expectedFrom` (line 47) reads `platform` with the `yaml` package. That import is allowed here because `platform-rules` runs in the verify job, which installs dependencies. The protected-change job does not install them, and that sensor still does not import `yaml`.

`platform.mode` is `warn` at `harness.yaml` line 205. `sensors.yaml` writes `platform-rules` at line 192 with `tier: commit` and `where: [ci]`. The runner reads that row and does not run the sensor on a local turn.

The branch rules request is `GET /repos/{owner}/{repo}/rules/branches/{branch}` with the documented `per_page` and `page` query parameters. `repository.default_branch` comes from the event. `GITHUB_REPOSITORY` supplies the owner and repo. `fetchRules` (line 71) follows pages until one returns fewer than 100 rules.

The label `protected-change-approved` is written by a person on GitHub. `clearProtectedLabel` deletes it on `pull_request_target` `synchronize`. The sensor job `needs` that job with `if: always()`.

`recordCredentials` reads `harness/state/report.json` and writes the `credentials` field back. A-110 plants `status: pass` and the hook leaves that status in place. The values of `GH_TOKEN` and the other named variables are not written. `gh auth status` contributes the login only.

`docs/platform-gates.md` and `docs/agent-identity.md` are the writers for the setting lines `settingFindings` reads. Each of those lines carries an `https://` URL from the page that names the setting.

## Bypass check

The deciding copy of protected-change is the base checkout.

- Shell route. The head commit replaces `protected-change.mjs` with `process.exit(0)` and adds `DROP TABLE`. A-102 spawns the sensor script from the base checkout and the run exits 1 on the pattern.
- State-file route. A-102 writes `protected-change.json` with `status: pass` before the run. The entry point overwrites it. The asserted status is `fail`.
- Flag route. A-101 parses the workflow and rejects a checkout `ref` that points at the pull request head, a `git checkout` of the fetched ref, and `npm install`. There is no CLI flag that selects the head.

A direct push to the default branch replaces this workflow and the sensor. The events page says `pull_request_target` uses the default branch's workflow file. The setting that closes that route is the ruleset rule "Require a pull request before merging" (available rules for rulesets). This repo does not have that ruleset. No further pattern match was added for this route.

Pattern lines still need a current code-owner label.

- Shell route. A-119 spawns the sensor. A label older than `pull_request.updated_at` exits 1. A label from `@ada` after that timestamp exits 0. A-68 spawns the same script for an actor who is not in `CODEOWNERS` and exits 1.
- State-file route. The label is not read from a local file. A-102 shows a planted `protected-change.json` does not become the decision.
- Flag route. A-65 and A-66 spawn the sensor with `APPROVED` reviews on the head SHA, including a review from the code owner. Both stay exit 1 and do not print `route review`. There is no flag that turns a review into a pass.

`platform-rules` decides from the API payload, not from a local file.

- Shell route. A-105, A-106, A-107, A-108, and A-109 spawn `platform-rules.sh`. A payload with no rules exits 1 when `platform.mode` is `block`. An unmapped type is `unknown` and is not a pass.
- State-file route. The script does not read `report.json` or any other state file. The tests do not plant one, because there is no file that can stand in for the rules response.
- Flag route. There is no CLI flag that marks a missing rule as present. `platform.mode` is data in `harness.yaml`, which is a protected check path.

The bypass list is the gap that identity and a GitHub setting close. The REST page says `bypass_actors` is returned only when the caller has write access to the ruleset, and the branch-rules example has no `bypass_actors` field. A-107 asserts the output always contains `bypass list not visible to this token, check Settings` and never calls that list safe. The setting that closes the route is an empty bypass list on the ruleset, including repository administrators (`docs/platform-gates.md`). No further pattern match was added.

Session start names credentials. It does not block.

- Shell route. A-110 spawns the hook with `GH_TOKEN` set and asserts the name is present and the value is absent. A-111 puts a fake `gh` first on `PATH`. A-113 asserts both the quiet run and the named run exit 0.
- State-file route. A-110 writes `report.json` with `status: pass` before the hook. The hook keeps that status and replaces `credentials` with what it just collected. A planted empty `credentials` list does not survive the run.
- Flag route. The hook path has no flag that suppresses the warning. `credentialsFor` in `session_start.mjs` (line 68) always returns a credentials object, and the hook always prints it.

What the warning cannot see is the remaining route. A-112 asserts the line that names files the sensor does not know, keychains, and SSO caches. Closing that route is the developer's environment, not another matcher. `docs/agent-identity.md` says the same thing about a token the agent can already read: GitHub cannot tell the agent from the developer.

## Known gaps and rerun commands

The ruleset is documented in `docs/platform-gates.md` and compared by `platform-rules`. It is not applied on this repository. Until "Require a pull request before merging" and the required checks `verify` and `protected-change` are on, a red check does not block a merge. `platform.mode` stays `warn` because this repository has one maintainer. A two-approval required reviewer rule cannot be met by one person. The `protected-change-approved` label is an audit trail for a pattern line. It is not a second reviewer.

The required reviewer rule is not available on a user-owned repository, because that account has no teams (available rules for rulesets). The REST response names `reviewer.id` and `reviewer.type`, not a team slug, so the sensor checks `minimum_approvals` and `file_patterns` only.

GitHub's about-rulesets page says: "Push rulesets are available for the GitHub Team plan in internal and private repositories, and forks of repositories that have push rulesets enabled." This repository is public, so "Restrict file paths" is not available here.

`GET /repos/{owner}/{repo}/rules/branches/{branch}` does not return rulesets whose enforcement is `evaluate` or `disabled`. A ruleset that is only being evaluated is invisible to `platform-rules`. The sensor does not treat that silence as a pass.

GitHub's "Securely using pull_request_target" page says public repositories that do not already have an Actions event policy get a default policy that blocks `pull_request_target`. That policy is described as running in evaluate mode, with enforcement called out separately. This page does not say whether this repository already has an event policy. If the default policy applies, the protected-change workflow does not run until an event policy allows the event.

The example estate does not deploy. The production environment, "Prevent self-review", environment secrets, and the OIDC `sub` claim are documented in `docs/platform-gates.md` and are not configured here.

`./verify.sh --turn` still fails `check-integrity` until a person at their own terminal records `.github/workflows/protected-change.yml` and `harness/lib/enforce/**`. The agent environment cannot record that. The log was not edited.

`node --test harness/lib/checks/protected-change.test.mjs harness/lib/checks/platform-rules.test.mjs harness/lib/checks/platform-gates.test.mjs harness/lib/enforce/credentials.test.mjs`

acceptance-checker: PASS
