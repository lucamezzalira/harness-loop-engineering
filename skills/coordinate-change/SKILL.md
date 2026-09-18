---
name: coordinate-change
description: Plan a change that spans repositories before opening pull requests. Use when more than one repo must move together.
---

# Coordinate a cross-repo change

1. Pick one task id and use it in every branch name and pull request title
   (`feat/<TASK-ID>-<slug>`).
2. Write the merge order before any PR opens: shared contracts first, then
   producers, then consumers.
3. Open the pull requests as a set. Each PR description links to the others.
4. Have a human review that plan before work fans out to the other repos.
5. Do not grant an agent write access across repos to "save time." Pin and sync
   shared assets with `scripts/harness-sync.sh` instead.

This skill is a checklist for a human workflow. It is not an orchestrator.
