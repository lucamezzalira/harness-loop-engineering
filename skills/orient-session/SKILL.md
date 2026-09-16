---
name: orient-session
description: Read session orientation before starting work on a long-running goal. Use at the start of a session, after compaction, or when resuming loop.sh.
---

# Orient session

Before picking the next piece of work:

1. Read the orientation block from `session_start` (working directory, recent
   commits, `PROGRESS.md` tail, features passing against total, whether
   `scripts/init.sh` exists).
2. Read `PROGRESS.md` in full if the tail is ambiguous.
3. Read `features.json` when it exists. Treat `passes: false` as unfinished work.
   You may flip `passes` and `testId`, and you may append features. Do not remove
   features or edit other fields.
4. Run `scripts/init.sh` when it exists, then `scripts/verify.sh turn` to confirm
   the tree is still green before implementing.
5. Only then choose the next failing feature.

Procedures live here so `AGENTS.md` can stay short.
