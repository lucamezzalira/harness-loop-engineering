# diff-scope

A single change set touched more than one bounded context (`contexts:` in
`harness.yaml`) without adding or updating an ADR.

Fix: split the PR by context, or add `docs/adr/NNNN-*.md` that justifies the
cross-context work, then re-run `./verify.sh --turn`.
