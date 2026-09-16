# 00-minimal: the control

This scenario is the unstructured baseline. Bash only. No `AGENTS.md`, no skills,
no roles, no hooks, and no generated adapters. It applies the same newsletter
defect set (D1 to D6) the full harness runs against, so the comparison is honest.

The design philosophy is mini-swe-agent: a capable model, a shell, and a short
prompt. Structure is what this repo usually adds. This example is what you get
when you refuse to add it.

## Start

```bash
scripts/scenario.sh start 00-minimal
cd ../.scenarios/00-minimal
```

Open the worktree in your agent of choice. Paste the contents of `prompt` as the
only instruction. Do not restore adapters or hooks for the run.

## What to compare

Run the same seed under scenario `04-enforcement` or a full harness worktree.
Record which defects each run fixes. The point is the gap, not a flattering
score for either side.

## Files

| File              | Role                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `prompt`          | Single high-level instruction. Nothing else.                        |
| `seed.patch`      | Removes harness wiring and applies D1 to D6.                        |
| `expectations.md` | Written before any run. What we expect the baseline to do and miss. |
