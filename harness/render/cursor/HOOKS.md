# Cursor hooks adapter (split-event, shell-thin)

## Design: adapter ≠ implementation language

Thin scripts under `.cursor/hooks/*.sh` only:

1. Resolve the repo root
2. Set `HARNESS_HOOK_MOMENT` / `HARNESS_IN_HOOK` / `HARNESS_TOOL`
3. `exec ./verify.sh --hook` (stdin passes through untouched)

They do **not** parse JSON and do **not** call Node. If `verify.sh` later
delegates to Go, Python, or anything else, the Cursor adapter stays the same.

## Default: hooks off

```yaml
# harness.local.yaml
tool: cursor
hooks:
  enable: true
  failClosed: true   # only beforeShellExecution / beforeMCPExecution
```

Scripts are always copied on `--render` so you can fixture-test before enabling.

## Event map

| Cursor event | Script | Blocks? | failClosed when enabled |
|--------------|--------|---------|-------------------------|
| `sessionStart` | `bash hooks/session-start.sh` | no | false |
| `beforeShellExecution` | `bash hooks/before-shell.sh` | yes (exit **2**) | `hooks.failClosed` |
| `beforeMCPExecution` | `bash hooks/before-mcp.sh` | yes (exit **2**) | `hooks.failClosed` |
| `afterFileEdit` | `bash hooks/after-edit.sh` | no | false |
| `stop` | `bash hooks/stop.sh` | soft: `followup_message` | false |

No catch-all `preToolUse`.

## Fixture tests

```bash
./verify.sh --render
node --test harness/lib/hooks/fixtures.test.mjs
```

```bash
echo '{"command":"rm -rf /"}' | bash .cursor/hooks/before-shell.sh
# → exit 2
```

## Recovering from a wedged Cursor

```bash
echo '{"version":1,"hooks":{}}' > .cursor/hooks.json
# Developer: Reload Window
```
