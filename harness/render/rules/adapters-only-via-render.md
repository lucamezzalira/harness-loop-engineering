---
description: Ensures tool adapters under dot directories are written only by verify render
alwaysApply: true
---

# Adapters only via render

When agent or human edits would change files under `.cursor/`, `.claude/`, or
`.codex/`, the system shall leave those trees to `./verify.sh --render`, because
hand-edited adapters drift from `harness/render/` and the next render overwrites
or fights the change.

## Signals of violation

- Manual edits to `.cursor/rules/`, hooks, or agents without a matching source
  change under `harness/`
- Commits that change generated adapter files while `harness/render/` is
  untouched
- Instructions that tell the agent to "just edit `.cursor/`" for a standing rule

## How to satisfy it

Edit the source under `harness/render/` or `harness/roles/`, then run
`./verify.sh --render` for the active tool. Do not patch generated files in
place.
