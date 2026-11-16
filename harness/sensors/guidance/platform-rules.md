# platform-rules

Commit tier, CI only. The script is `harness/sensors/checks/platform-rules.sh`. It runs `harness/lib/checks/platform-rules.mjs` and calls `GET /repos/{owner}/{repo}/rules/branches/{branch}`.

The branch is `repository.default_branch` from the Actions event. The endpoint returns every active rule that applies to that branch, at whatever level it was configured. Rulesets whose enforcement is `evaluate` or `disabled` are not in the response. https://docs.github.com/en/rest/repos/rules

`platform` in `harness.yaml` is the expected set. `platform.mode` is `warn` or `block`. `warn` prints each miss and exits 0. `block` exits 1. This repository's mode is `warn` because it has one maintainer.

Mapped rule types, and only these, come from that REST page:

- `pull_request`, with `required_approving_review_count`, `require_code_owner_review`, `dismiss_stale_reviews_on_push`, and `require_last_push_approval`.
- `pull_request.parameters.required_reviewers`, with `file_patterns`, `minimum_approvals`, and `reviewer.type` (`Team`). The page does not name a team slug. A team name in the UI is not something this response can confirm. The sensor checks the minimum and the file patterns, which it reads from `protect.checkPaths` and `review.humanRequired.paths`.
- `required_status_checks`, matched on `parameters.required_status_checks[].context`.

Any other `type` is printed as `unknown <type>`. That line is not a pass.

The same REST page says `bypass_actors` on a repository ruleset is returned only when the caller has write access to the ruleset. The branch-rules example response does not include `bypass_actors`. Every run prints `bypass list not visible to this token, check Settings`. The sensor never reports the bypass list as safe.

A missing token or a non-OK response exits 2. `per_page` and `page` are the documented query parameters. The client stops when a page returns fewer than 100 rules.

The required reviewer rule is not available on user-owned repositories, because those accounts have no teams. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
