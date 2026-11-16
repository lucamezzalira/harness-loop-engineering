# protected-change

## Why this exists

Local hooks are an early warning. The deciding copy of this sensor is the one on the base branch. A pull request cannot replace it by editing the file in its head.

`pull_request` and `pull_request_review` both set `GITHUB_REF` to the pull request merge branch `refs/pull/PULL_REQUEST_NUMBER/merge`. A workflow run on those events uses the workflow from that merge commit, so a pull request that edits the workflow or this sensor would be judged by its own copy.

https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows

`pull_request_target` runs in the context of the base repository's default branch. The workflow checks out the pull request's base SHA and fetches `refs/pull/<n>/head` as data. It computes `git diff --name-only` and `git diff -U0` against the merge base. It does not npm install, and it does not run a script from the fetched ref. That is the safe shape: the pull request is read as data and nothing from it is executed.

https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target

The events page lists `GITHUB_REF` for `pull_request_target` as the default branch, and the security page says a checkout with no `ref` is taken from that default branch. This job sets `ref` to `github.event.pull_request.base.sha` so the sensor and `harness.yaml` are the base commit of the pull request. That SHA is a commit on the base repository. It is not the head. The docs do not say an omitted `ref` follows a non-default base branch, so the job names the base SHA instead of guessing.

## What to do

1. This sensor does not run in the verify tiers. `sensors.yaml` sets `tier: manual` and `where: [ci]`. `.github/workflows/protected-change.yml` runs `harness/sensors/checks/protected-change.sh` directly. `./verify.sh --status` lists it on the `base-branch workflow` line.
2. Added lines that match `review.humanRequired.patterns` fail until a `CODEOWNERS` owner adds `protected-change-approved` after the latest push. A `labeled` event older than the pull request's `updated_at` on `synchronize` does not count. The clear job removes the label on `synchronize` before this job reads it (`needs: clear-protected-label`, `if: always()`).
3. A protected path exits 0 only when `GET /repos/{owner}/{repo}/rules/branches/{branch}` returns an active `pull_request` rule with `require_code_owner_review` true. The output names that rule and the `ruleset_source` and `ruleset_id` from the response. The branch is the pull request's base branch. Both this sensor and `platform-rules` read that response through `harness/lib/checks/branch-rules.mjs`. Rulesets whose enforcement is `evaluate` or `disabled` are not returned, so they count as absent.
   https://docs.github.com/en/rest/repos/rules
   If that rule is not active, the protected path fails until a `CODEOWNERS` owner adds `protected-change-approved` after the latest push. The timeline and stale-label check are the same ones used for a pattern line. If the rules cannot be read, for a protected path or a pattern line, the sensor exits 2. The message names the missing token, the HTTP status, or the malformed field, and it says the check failed closed and the label route applies. That run does not exit 0.
4. A direct push of a matching change to the default branch, with no pull request, still fails if this entry point is invoked. The workflow itself is not triggered by `push`.
5. The job permissions are `contents: read`, `pull-requests: read`, and `issues: read`. Only the label-removal job has `issues: write`.

`GITHUB_TOKEN` is read from the environment. It is not a flag. The script reads `harness.yaml` from the checkout with a small list reader. It does not import the `yaml` package, because the workflow does not install dependencies.
