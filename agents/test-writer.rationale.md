# Test-writer rationale

The weaker the deterministic oracle for a role, the stronger the model that role needs. See README.md.

## Oracle strength

MODERATE. Stryker mutation kill rate plus a green commit tier (`90-suite`, `70-build`) catch empty tests and tests that never failed. They do not catch a test that asserts the wrong behaviour with perfect confidence.

## Failure cost

A false negative (a test that does not actually lock the behaviour) is a silent hole. A false positive (an extra assertion) is cheap if the commit tier stays green. Production edits from this role are the expensive failure, which is why the prompt forbids them.

## Run frequency

Per feature or per review finding, after production code exists. Not on every edit.

## Context need

The production module under test, neighbouring tests for style, and the defect or behaviour to lock. Not the whole system.

## Evidence

`eval/results/baseline.json`, 2026-09-15. Scorer is mutation kill rate plus commit-tier green. Prior: `balanced` holds kill rate within noise of `deep` on the newsletter fixtures, which is why this is not a deep role. Re-read the file after `eval/run.sh`.

## Revisit when

A `fast` test-writer keeps commit tier green and stays within 5 points of `balanced` mutation kill rate across three repeats. Until that holds, stay on balanced.
