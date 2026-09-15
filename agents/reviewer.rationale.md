# Reviewer rationale

The weaker the deterministic oracle for a role, the stronger the model that role needs. See README.md.

## Oracle strength

WEAK. The output is prose (structured, but still a list of claims) read by a human or injected back into the agent. Nothing in `verify.sh` catches a defect this role failed to mention.

## Failure cost

A false negative is a shipped defect. A false positive is a wasted review cycle. The stop hook caps cycles (`review.maxCycles`) and then surfaces leftovers to the human, so extra findings are recoverable. Missed findings are not, which is why this role is deep.

## Run frequency

Per stop, on the accumulated diff since `lastReviewedHash`, after the turn tier is green when `review.requireVerifyGreen` is set. Unrelated to `eval/`, which scores this same prompt on demand against seeded tasks.

## Context need

The diff between the last reviewed tree and now, plus `AGENTS.md` and the relevant service contracts. Not the whole repository and not a single edited file.

## Evidence

`eval/results/baseline.json`, 2026-09-15. Direct invocation (`invocation: direct`), three repeats, six planted defects in `examples/10-newsletter`. Prior used to choose the tier: deep is expected to report D3 (boundary import) which lint, types, and unit tests all miss. Fast is expected to drop it. Re-read the file after `eval/run.sh`.

## Revisit when

Moving reviewer from `deep` to `balanced` does not drop recall on D3 and D5 across three repeats in `eval/results/runs.jsonl`. If it does, stay on deep.
