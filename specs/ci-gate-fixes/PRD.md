# PRD: Fix the CI gate and finish the docs

The gate left four holes, and the docs for that decision were never written.

1. A status test ran against the real repo, so it needed a local config file a clean clone does not have.
2. On a new push, verify could read the solo label before the clear job removed it. GitHub does not start a new workflow run for an event made with the workflow token.
3. The ship gate did not refuse label, review, or merge commands.
4. `harness/**` was the last line in CODEOWNERS, so it overrode every more specific harness rule. The report sensor treated a partial acceptance file as complete.

## Acceptance

- A-84: No test runs the CLI with `cwd` set to the real repo root. A static scan of every test file fails if it finds a spawn of `cli.mjs` or `verify.sh` with `cwd: ROOT`. The clean-clone evidence is the CI step in A-85. A test must not spawn `npm test`.
- A-85: The CI workflow has a "Unit tests (no local config)" step that runs `npm test` before any step that writes the local config file.
- A-86: The verify job has `needs: clear-protected-label` and `if: always()`.
- A-87: A synchronize event whose label was added before the event fails. The same timeline with the label added after the event passes. The timestamp is the event's own, not a commit date.
- A-88: Without a ship instruction, `pre_tool` refuses adding or removing a label, approving a review, merging, `gh label`, and `gh api` paths that contain `/labels`, `/reviews`, or `/merge`. The reason names the ship gate.
- A-89: `gh pr view` and `gh pr checks` stay allowed.
- A-90: CODEOWNERS lists `harness/**` before every other `harness/` rule.
- A-91: `codeowners-coverage` fails when a broad glob comes after a more specific glob it covers, and passes on this tree.
- A-92: A spec whose PRD names ids that are missing from `acceptance.json` fails, and the output names those ids.
- A-93: `Deferred: A-NN (reason)` lines in the PRD take those ids out of scope. Removing one line fails the check again.
- A-94: `report-present` is green for every spec on this tree, including the gate spec once its remaining ids are listed and passing.

## Out of scope

- Turning on GitHub branch protection. The docs mention it as optional.
- Wiring a before-write hook, model changes, scheduled loops, the retired host, deployment.
- CI providers other than GitHub Actions.
