---
name: start-a-session
description: Use at the beginning of any coding session before picking up work.
---

1. Read `HANDOFF.md` (newest first).
2. Read recent `git log -5 --oneline`.
3. Check acceptance counts under `specs/*/acceptance.json`.
4. Confirm services still start (or note they do not).
5. Run `./verify.sh --status` and note skipped checks.
6. Only then choose the next unit or task.
