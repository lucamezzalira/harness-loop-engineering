# 03-verify-in-the-loop

## Goal

Add verification and the stop hook so the agent has to self-correct before it
may claim the turn is finished.

## Setup

```bash
scripts/scenario.sh start 03-verify-in-the-loop
cd ../.scenarios/03-verify-in-the-loop
```

`seed.patch` leaves hooks enabled and sets `review.enabled` so the stop path
runs turn-tier verify (and review when verify is green). Use a prompt that
tempts a shallow fix, such as changing a type without updating tests.

## What to watch

The first stop fails. The agent reads `.verify/report.json`, fixes the failing
stage, and only then completes. That retry loop is the product.

## What usually goes wrong

Treating exit code 2 as a code defect and retrying forever. Exit 2 means the
harness is wrong (missing tool, bad config). Stop and report it.
