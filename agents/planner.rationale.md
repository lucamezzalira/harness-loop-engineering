# Planner rationale

The weaker the deterministic oracle for a role, the stronger the model that role needs. See README.md.

## Oracle strength

WEAK. Nothing in `verify.sh` can tell a good plan from a plausible one. A missed task shows up later as a missing test or a wrong boundary, not as an exit code.

## Failure cost

A false negative (skipped work, hidden coupling) ships as a surprise mid-implementation. A false positive (an extra task) costs a turn. Under-planning is more expensive than over-planning, which is why this role is deep rather than balanced.

## Run frequency

Interactive, at the start of a piece of work, and again if the tree hash moves in a way the original plan did not cover.

## Context need

The PRD or prompt, `AGENTS.md`, the relevant skill, and the current tree layout. Not the diff of a turn in progress.

## Evidence

`eval/results/baseline.json`, 2026-09-15. Planner is not in the component eval matrix (that suite scores reviewer, test-writer, and qa). Prior: a weaker model drops cross-service tasks on the newsletter example. Re-read the file after a pipeline-tier eval exists.

## Revisit when

A planner on `balanced` produces task lists whose later `eval/` pipeline score matches `deep` across three repeats. Until that number exists, keep deep.
