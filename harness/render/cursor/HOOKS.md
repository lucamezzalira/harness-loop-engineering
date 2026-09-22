# Cursor hooks adapter (portable four, shell-thin)

Thin scripts under `.cursor/hooks/*.sh` only:

1. Find repo root (walk up for `verify.sh` + `harness/`)
2. Export `HARNESS_ROOT`, `HARNESS_IN_HOOK=1`, `HARNESS_TOOL=cursor`, `HARNESS_HOOK_MOMENT`
3. `exec ./verify.sh --hook`

## Defaults: hooks on

```yaml
# harness.yaml (committed defaults)
hooks:
  enable: true
  failClosed: false
```

If changing this, know that agents regain the ability to ship without a green report. Prefer narrowing matchers over turning the layer off.

`--status` prints `enforcement: on|off` in its first lines. `--render` lists each wired event.

## Events (exactly four)

| Event | Script | Can refuse | failClosed |
| ----- | ------ | ---------- | ---------- |
| `sessionStart` | `bash hooks/session-start.sh` | no | false |
| `beforeShellExecution` | `bash hooks/before-shell.sh` | yes (exit **2**) | `hooks.failClosed` |
| `afterFileEdit` | `bash hooks/after-edit.sh` | no | false |
| `stop` | `bash hooks/stop.sh` | soft: `followup_message` | false |

`beforeMCPExecution` is optional: copy from `harness/render/cursor/optional/before-mcp.sh` if you want MCP gated the same way as shell.

## Fixture test

```bash
node --test harness/lib/hooks/fixtures.test.mjs
```

## Recovery (wedged Cursor)

```bash
echo '{"version":1,"hooks":{}}' > .cursor/hooks.json
```

Then Reload Window. Re-enable with `./verify.sh --render` after fixing the cause.
