---
name: write-tests
description: Add tests for existing production behaviour. Use when the implementation is in place and the gap is coverage, a reproduction, or locking a review finding.
---

# Write tests

Delegate to the `test-writer` role. It writes tests only and must leave the commit tier green.

If you actually need a failing reproduction of a bug before a fix, use the `qa` role instead. That role is forbidden from patching production code too, and its output is a fail-then-pass pair rather than a coverage increment.

Do not write tests that `verify.sh` cannot run. Match the runner already in the tree.
