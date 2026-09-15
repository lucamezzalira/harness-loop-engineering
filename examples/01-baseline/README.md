# 01-baseline

## Goal

See what an agent produces with no project context and no harness hooks. The
output is often plausible and confidently wrong, which is the point.

## Setup

```bash
scripts/scenario.sh start 01-baseline
cd ../.scenarios/01-baseline
```

`seed.patch` blanks `AGENTS.md` and disables Cursor and Claude hooks so the
session has neither instructions nor enforcement. Give the agent a small,
underspecified task (for example: "add unsubscribe to the newsletter services")
without pointing it at `examples/10-newsletter/README.md`.

## What to watch

How quickly the agent invents APIs, folder layouts, and "best practices" that
are not in the tree. Compare the result to a run of `02-context-only` on the
same prompt.

## What usually goes wrong

People blame the model. The failure mode here is missing context and missing
feedback, not raw capability. Do not add `AGENTS.md` mid-run if you want a
clean baseline.
