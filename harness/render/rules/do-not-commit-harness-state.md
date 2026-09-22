---
description: Ensures harness session and cost state stays untracked and uncommitted
alwaysApply: true
---

# Do not commit harness state

When finishing a change, the system shall not stage or commit paths under
`harness/state/`, because that tree is regenerated per session and committing it
leaks machine-local session and cost noise into the shared history.

## Signals of violation

- `git add` of files under `harness/state/`
- PRs that show session, cost, or log artifacts from `harness/state/`
- Removal of `harness/state/` from `.gitignore`

## How to satisfy it

Leave `harness/state/` alone. It is gitignored machine output. Persist durable
notes in `HANDOFF.md` or `docs/`, not under `harness/state/`.
