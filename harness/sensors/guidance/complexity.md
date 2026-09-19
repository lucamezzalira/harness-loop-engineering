# complexity

## Why this exists
Agents produce long functions with many branches. Complexity is a proxy for review risk and for mutation-testing cost.

## What to do
1. Extract helpers; flatten nested conditionals.
2. Prefer early returns over deep nesting.
3. Re-run the turn tier after the split.

## Thresholds
If refactoring is genuinely impossible in this unit, raise `baseline.maxComplexity` slightly in `harness.yaml` and record a reason. The raised value becomes the first thing worth looking at in human review.
