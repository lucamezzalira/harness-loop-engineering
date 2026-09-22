# session-state

Local-only sensor. CI containers start with empty state, so this check is
filtered by `where: [local]` and never scheduled when `HARNESS_ENV=ci`.

## Fix

1. Ensure `harness/state/` exists and is writable (`./verify.sh --install`).
2. If HANDOFF.md has session entries, restore or recreate session markers
   (`session.json`, `report.json`, or `logs/<id>/`) before continuing.
3. Do not commit `harness/state/` contents.
