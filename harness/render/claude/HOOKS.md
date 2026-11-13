# Claude Code hooks adapter (portable four)

Thin scripts under `.claude/hooks/*.sh` only:

1. Find repo root (walk up for `verify.sh` + `harness/`)
2. Export `HARNESS_ROOT`, `HARNESS_IN_HOOK=1`, `HARNESS_TOOL=claude`, `HARNESS_HOOK_MOMENT`
3. `exec ./verify.sh --hook`

## Events (exactly four)

| Event          | Script                   |
| -------------- | ------------------------ |
| `SessionStart` | `hooks/session-start.sh` |
| `PreToolUse`   | `hooks/pre-tool.sh`      |
| `PostToolUse`  | `hooks/post-tool.sh`     |
| `Stop`         | `hooks/stop.sh`          |

## Defaults

`hooks.enable` defaults to true. Override it in `harness.local.yaml`. `--render` writes `.claude/settings.json` and copies the scripts. First line of `CLAUDE.md` is `@AGENTS.md`.

`PreToolUse` calls `pre_tool`, which refuses a write under `harness/state/` and any command containing `--allow-check-edit`. Claude Code sets `CLAUDECODE` and `CLAUDE_CODE_CHILD_SESSION` on the commands it spawns. Either marker refuses the flag, and so does `HARNESS_IN_HOOK=1`. A person at the developer's own terminal can still record a local early warning. CI `protected-change` decides on the pull request.

## Recovery

```bash
echo '{"hooks":{}}' > .claude/settings.json
```

Then fix the underlying issue and re-run `./verify.sh --render`.
