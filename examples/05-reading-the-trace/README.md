# 05-reading-the-trace

## Goal

Stop treating the agent as a black box. Turn tracing on, run a task that goes
wrong, open the trace, and find out why from the recorded events.

## Setup

```bash
scripts/scenario.sh start 05-reading-the-trace
cd ../.scenarios/05-reading-the-trace
```

`seed.patch` sets `trace.enabled: true` and `trace.level: events` in
`harness.config.yaml`. Provoke a failure (a red turn tier, a denied commit, or
a reviewer bounce), then inspect `.harness/trace/`.

## What to watch

Which tool calls ran, which verify stage failed, and whether the agent changed
strategy after the failure or repeated the same edit. The trace is the
difference between guessing and debugging.

## What usually goes wrong

Leaving `trace.level: full` on by default. Full captures source and prompt text,
which is useful for a short forensic session and expensive (and sensitive) as a
standing setting. Switch back to `events` or disable tracing when the lesson
ends.
