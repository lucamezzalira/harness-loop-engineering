# protected-change

## Why this exists

Local hooks are an early warning. They are only as strong as the tool that sends them. CI on the pull request decides whether a protected change was approved.

## What to do

1. This sensor runs in CI only (`where: [ci]`, commit tier). `./verify.sh --status` lists it as CI-only. It does not run locally.
2. A protected file needs an `APPROVED` review on the pull request head from a `CODEOWNERS` owner who is not the author.
3. When the author is the only owner, a code owner adds the `protected-change-approved` label after the latest push. A synchronize event removes that label.
4. A direct push of protected changes to the default branch, with no pull request, fails.
5. Without branch protection, a red result warns and does not stop a merge. Turning that on in GitHub is optional.

`GITHUB_TOKEN` is read from the environment. It is not a flag.
