# Platform gates

These settings live in GitHub. The sensors in this repo read them or document them. They do not turn the settings on. Apply each one in the repository settings before you treat a merge as gated.

A direct push to the default branch replaces `.github/workflows/protected-change.yml` and the sensor. The rule that closes that route is on the default branch.

## Ruleset on the default branch

- **Require a pull request before merging** stops a direct push to the default branch, which is the route that would replace the protected-change workflow. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- **Required approving reviews** is the specific number of approving reviews the available-rules page describes under that pull request rule. Leave it off on this user-owned repository. The only maintainer cannot approve their own pull request. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- **Require review from code owners** is the option to require reviews from code owners before merge. Leave it off here for the same reason. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- **Dismiss stale pull request approvals when new commits are pushed** drops an approval when the diff changes after the review. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- **Require approval of the most recent reviewable push** asks for an approval from someone other than the last person to push. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- **Require status checks to pass before merging** blocks the merge until the named checks pass. Expect `verify` and `protected-change`. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- **Required reviewers** requires a team, and a minimum number of approvals from that team, when the pull request changes the sensitive globs (`review.humanRequired.paths` and `protect.checkPaths`). The minimum here is 2. The rule is generally available as of 17 February 2026. It is not available on a user-owned repository, because that account has no teams. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets https://github.blog/changelog/2026-02-17-required-reviewer-rule-is-now-generally-available/
- **Bypass list** stays empty, and that includes repository administrators. About rulesets says you can allow a role such as repository administrator to bypass the rules. Do not add one. The sensor cannot see this list with a read token. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- **Restrict file paths** is a push ruleset rule. GitHub's wording is: "Push rulesets are available for the GitHub Team plan in internal and private repositories, and forks of repositories that have push rulesets enabled." This repository is public, so it cannot use that rule. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets

`platform-rules` compares the live rules with `platform` in `harness.yaml`. `platform.mode` is `warn` in this repository. It prints each miss and exits 0. `block` exits 1. The REST page does not return rulesets whose enforcement is `evaluate` or `disabled`, so a ruleset that is only being evaluated is invisible to the sensor. https://docs.github.com/en/rest/repos/rules

On this user-owned repository the realistic ruleset is "Require a pull request before merging", required status checks `verify` and `protected-change`, and an empty bypass list. Leave code owner review and required approvals off. The only maintainer cannot approve their own pull requests, and the required reviewer rule needs a team.

The `protected-change-approved` label is how a protected path gets a human decision when that code owner rule is not active. A code owner adds it after the latest push. It is self-approval with an audit trail. It is not a second reviewer. The same label still gates a line that matches `review.humanRequired.patterns`.

`protected-change` reads the base branch's active rules through the same module as `platform-rules`. A `pull_request` rule with code owner review active is the only case where a protected path exits 0 without the label. The output names the ruleset source and id. If the rules cannot be read, the sensor exits 2. The message names the missing token, the HTTP status, or the malformed field, and it says the check failed closed and the label route applies. That run does not exit 0. The branch-rules endpoint does not return `bypass_actors` to a read-only token, so a bypass list that includes the author is invisible here. The empty bypass list in Settings is what closes that route. https://docs.github.com/en/rest/repos/rules

## What must stay off

- **Copilot code review approvals** stay off. The changelog says the ability for Copilot to approve is off by default, and that an enabled approval counts toward the repository's required-approvals rule. Leave it off. https://github.blog/changelog/2026-09-01-copilot-code-review-can-now-approve-pull-requests
- **Allow GitHub Actions to create and approve pull requests** stays off. The setting is under Workflow permissions. https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository

## Deploy

The example estate does not deploy. This section is documentation for a repository that does.

- **Required reviewers** on a GitHub environment named production require a person or team to approve a job that references that environment. https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- **Prevent self-review** is the deployments page option to prevent self-reviews, so the user who starts the deployment cannot approve it. https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- **Environment secrets** are available only to jobs that reference the environment. If the environment requires approval, the job cannot read them until a required reviewer approves. https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- **OIDC trust policy** for the cloud role must name that environment only. The AWS page says the `sub` claim for an environment is `repo:ORG-NAME/REPO-NAME:environment:ENVIRONMENT-NAME`. https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
