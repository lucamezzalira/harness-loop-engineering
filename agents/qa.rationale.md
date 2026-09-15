# QA rationale

The weaker the deterministic oracle for a role, the stronger the model that role needs. See README.md.

## Oracle strength

STRONG. The reproduction either fails on the broken commit and passes on the fixed one, or it does not. That binary is checked without a judge.

## Failure cost

A false negative (could not reproduce) costs a human a few minutes. A false positive (a reproduction that fails for the wrong reason) is caught when it still fails on the fix. Neither ships a defect. Mistakes are caught for free, which is why this role is fast.

## Run frequency

Per reported defect, before a fix is written.

## Context need

The bug report, the broken commit, and enough of the surrounding test harness to add one reproduction. Not the product roadmap.

## Evidence

`eval/results/baseline.json`, 2026-09-15. Scorer is binary. Prior: `fast` matches `deep` on the planted newsletter defects because the oracle is the runner, not the prose. Re-read the file after `eval/run.sh`.

## Revisit when

A `fast` qa role falls below 100% binary score across three repeats on the fixture set. Then move it to balanced and re-measure.
