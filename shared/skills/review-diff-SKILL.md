---
name: review-diff
description: Review an accumulated diff for correctness defects. Use after a turn of implementation and before commit. Returns structured findings, not prose.
---

# Review a diff

Delegate to the `reviewer` role with the accumulated diff, not the last edit.

The reviewer returns a JSON array of `{file, startLine, endLine, category, severity, rationale}` and nothing else. Empty array means clean.

Do not ask it to fix anything. Do not ask it for style comments. After it returns, either act on the findings or surface them to the human if `review.maxCycles` is exhausted.

The gate is not the model's confidence. The gate is whether the array is empty, plus the tree hash comparison in the stop hook.
