# Report: protected paths fall back to the label

Reviewed against `specs/platform-gates-fallback/acceptance.json` (A-120 through A-125).

## Criteria

| ID    | Test                                           | Entry point                                                                                                                                                                                                             | Code path                                                                                                                                                                                                       | Last green run                           |
| ----- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| A-120 | `harness/lib/checks/protected-change.test.mjs` | Spawns `harness/sensors/checks/protected-change.sh` on a fixture pull request that edits `harness.yaml`. The mocked rules response is `[]`.                                                                             | `readCodeOwnerRuleset` (line 321) calls `fetchBranchRules`. An empty list is a successful read with no code owner rule, so `decideFile` (line 221) uses the label. A later `updated_at` makes that label stale. | `node --test` of this file on 2026-11-16 |
| A-121 | same file                                      | Same script. The mock returns one `pull_request` rule with `require_code_owner_review` true, `ruleset_source` `octo-org/octo-repo`, and `ruleset_id` 73.                                                                | `codeOwnerRuleset` (line 60 of `branch-rules.mjs`) reads those fields. `formatText` prints `ruleset_source` and `ruleset_id`.                                                                                   | same run                                 |
| A-122 | same file                                      | Same script, once with the rules route returning HTTP 500 and once with `GITHUB_TOKEN` empty. No label is present. The 500 run also passes an extra `--ruleset-decides` argument and a planted `protected-change.json`. | `unread` (line 316) throws exit 2. The message names `GitHub API 500` or `GITHUB_TOKEN`, then says the check failed closed and the label route applies.                                                         | same run                                 |
| A-123 | same file                                      | Reads the two sensor modules and walks `harness/` for `export const PULL_FIELDS`.                                                                                                                                       | Both import `./branch-rules.mjs`. The only definition is `harness/lib/checks/branch-rules.mjs`.                                                                                                                 | same run                                 |
| A-124 | same file                                      | Same script on `notes/schema.sql` containing `DROP TABLE`, first with a code owner rule and then with `[]`. A current label is added after both failures. A-119 in the same file also passed in this run.               | Pattern lines still go through `decidePattern` after a successful rules read. The rules result is not consulted for them.                                                                                       | same run                                 |
| A-125 | same file                                      | Same script on the `harness.yaml` pull request. The mock returns one rule object with no `type` field.                                                                                                                  | `fetchBranchRules` (line 44 of `branch-rules.mjs`) throws `rules response is missing type`. `unread` exits 2 and appends the fail-closed sentence.                                                              | same run                                 |

A-72 in `harness/lib/checks/protected-change.test.mjs` also passed in that run. A protected path with no token exits 2 and the output names `GITHUB_TOKEN`.

## Wiring proof

GitHub writes the rules response. `fetchBranchRules` (line 33 of `branch-rules.mjs`) calls `GET /repos/{owner}/{repo}/rules/branches/{branch}` through `github()`. `codeOwnerRuleset` reads `type`, `parameters.require_code_owner_review`, `ruleset_source`, and `ruleset_id`. Those names are the ones on the REST rules page. `protected-change` does not declare them again. A rule object with no string `type` is rejected in that same function before either sensor judges it.

The pull request event writes `pull_request.base.ref` and, when that is absent, `repository.default_branch`. `readCodeOwnerRuleset` reads the branch from there. `GITHUB_REPOSITORY` and `repository.full_name` supply the owner and repo. The workflow sets `GITHUB_TOKEN`. `github()` reads it. A missing token, a non-2xx response, a network error, or a malformed rule throws before the label decision. `fail()` in `github-api.mjs` sets exit code 2, and `unread` keeps that code.

`harness.yaml` writes `protect.checkPaths` and `review.humanRequired.paths`. `listsFromHarnessYaml` reads them from the base checkout. A person on GitHub writes `protected-change-approved`. `labelApprover` reads the issue labels and the issue timeline, and compares `created_at` with `pull_request.updated_at` on `synchronize`. That read happens only after the rules response was readable.

`writeBody` still overwrites `harness/state/protected-change.json`. A-120 plants `status: pass` and the entry point replaces it with `fail`. A-122 does the same on the exit 2 path: the catch at line 390 writes `status: fail` before the process exits.

## Bypass check

The fallback label is the decision when a readable response has no active code owner rule.

- Shell route. A-120 spawns the sensor script. With no rules and no label the run exits 1. A code owner label after `updated_at` exits 0. A later push exits 1. A-102 still spawns the same script from the base checkout after the head replaces the sensor file, so the head copy is not what runs. A-122 and A-125 spawn the same script when the rules cannot be read, and both exit 2.
- State-file route. A-120 writes `protected-change.json` with `status: pass` before the label run. The entry point overwrites it. The asserted status is `fail`. A-122 plants the same pass file before the HTTP 500 run. The catch writes `fail` before exit 2.
- Flag route. A-120 and A-122 spawn the script with an extra `--ruleset-decides` argument. The empty-rules run still exits 1. The HTTP 500 run still exits 2. The script does not read a flag that selects a pass.

A ruleset that requires code owner review can still list the author as a bypass actor. The REST page says `bypass_actors` is returned only when the caller has write access to the ruleset, and the branch-rules example has no `bypass_actors` field. This sensor cannot see that list. The setting that closes it is the empty bypass list in `docs/platform-gates.md`. No further matcher was added.

The label route is self-approval by a code owner, with the timeline as the audit trail. A-120 and A-68 show a non-owner does not count and a stale label does not count. The route is not closed in code. `docs/platform-gates.md` says so. An unreadable rules response exits 2 on that run. The message says the check failed closed and the label route applies.

## Known gaps and rerun commands

This repository is user-owned, so the required reviewer rule is not available, and the only maintainer cannot approve their own pull request. The realistic ruleset is a required pull request, status checks `verify` and `protected-change`, and an empty bypass list. Code owner review stays off. Until someone turns the code owner rule on, protected paths need the label.

Rulesets in `evaluate` or `disabled` enforcement are not in the branch-rules response. They count as absent, and the label is required. The sensor does not treat that silence as a pass.

`node --test harness/lib/checks/protected-change.test.mjs harness/lib/checks/platform-rules.test.mjs`

acceptance-checker: PASS
