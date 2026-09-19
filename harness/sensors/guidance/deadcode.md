# deadcode

## Why this exists
This check converts a sensor into a constraint the agent cannot silently skip.

## What to do
1. Read the tool output below.
2. Fix the underlying cause in the smallest change that restores the rule.
3. Re-run `./verify.sh` (or the tier that failed).

## Thresholds
If a numeric threshold blocks a genuine refactor that cannot shrink further, you may raise the threshold slightly in `harness.yaml` and record a one-line reason in the PR or HANDOFF. Do not suppress the check.
