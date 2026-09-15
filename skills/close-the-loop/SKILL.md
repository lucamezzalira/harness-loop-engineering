---
name: close-the-loop
description: Finish a turn. Run turn-tier verification, handle review findings, and only then attempt commit. Use when you are about to say you are done.
---

# Close the loop

Before claiming a task complete:

1. Run `scripts/verify.sh turn`. Exit 1 means fix the code. Exit 2 means stop and report. Do not retry a 2.
2. If the stop hook injects reviewer findings, treat them as required work, not suggestions. The structured array is the input.
3. Do not `git commit` on a tree whose `.verify/report.json` `treeHash` does not match the current tree, or whose status is not pass. The pre_tool hook will deny it. Honour `HARNESS_BYPASS` only with a real reason string, which is logged.
4. If `.harness/STOP` exists, halt.

Procedures live here so `AGENTS.md` can stay short.
