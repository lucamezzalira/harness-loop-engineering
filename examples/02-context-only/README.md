# 02-context-only

## Goal

Measure the ceiling of instructions alone. The agent gets `AGENTS.md` and
skills, and nothing that can fail a turn or block a commit.

## Setup

```bash
scripts/scenario.sh start 02-context-only
cd ../.scenarios/02-context-only
```

`seed.patch` keeps context files and turns hook wiring into no-ops. Ask for the
same task you used in `01-baseline`.

## What to watch

Quality rises when the agent loads skills and follows repo voice. It still
cannot tell a green claim from a red tree, because nothing runs
`scripts/verify.sh` on its behalf.

## What usually goes wrong

Stopping here and calling the harness "done". Context without a closed loop is
how you get tidy READMEs on top of broken code.
