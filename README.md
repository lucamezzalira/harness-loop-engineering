# Harness for Node projects

A standalone harness you drop into a Node repository. One executable is the entry point: `./verify.sh`.

It gives the coding agent a fixed set of guides, a fixed set of sensors, a small number of moments where it can be refused, and a review panel that runs on every piece of work.

Nothing ships (commit, push, pull request, deploy) without an explicit developer instruction in the current session. That is not configurable.

## Quick start

```bash
# from this repo, or after copying harness files into your service monorepo
npm install
cp harness.local.yaml.example harness.local.yaml   # or run --install
# edit harness.local.yaml and set exactly one of: tool: cursor | claude | codex
./verify.sh --install
./verify.sh --render
./verify.sh --turn
```

There is **no default tool**. If `tool` is empty, the harness exits `2` and tells you what to put in `harness.local.yaml`. Claude, Cursor, and Codex adapters are mutual exclusive (only one generated directory).

### Try the example estate

```bash
cd examples/two-services
npm install
npm test
node scripts/smoke-runtime-drift.js
```

## How it works

You have two ways to use this. Most of the time you use the first.

### 1. Turn mode (default): work like a normal Cursor chat

You (or the agent in this IDE) do the work in turns: prompt → edits → stop.

On the way, hooks and `./verify.sh` check the code:

1. After an edit → fast checks (`--edit`: format, lint, context budget).
2. When the agent tries to finish a turn → fuller checks (`--turn`) and usually the **reviewer** role.
3. Before commit → green `report.json` plus an **explicit yes from you**. The agent cannot commit on its own.

You stay in control of when to continue. Same rhythm as chatting with Cursor today.

### 2. Loop mode: run until the plan’s goals are met (or a brake fires)

```bash
./verify.sh --plan    # split the PRD into units → plan.json, then stop
./verify.sh --loop    # implement unit by unit until done or budget hits
```

`--loop` drives the agent through the plan without you prompting each turn. It stops when definition of done is met, or when `maxTurns` / `maxSeconds` / `maxCostUsd` / identical failures / `STOP` file / Ctrl-C says so.

Work ends **staged, not committed**. You still have to say commit/push/PR/deploy.

### Definition of done

A run (especially `--loop`) is done when all of these are true:

1. Every planned **unit** is marked complete.
2. Every `specs/<slug>/acceptance.json` entry with `passes: true` names a **test that exists and ran green** (the `acceptance` check). Entries may be added, never removed vs `HEAD`.
3. The **turn tier** is green on the final merged tree (after the last wave merge).
4. The review panel returns **no P0 or P1** (or `review.maxCycles` was hit and leftovers were escalated to a human via `HANDOFF.md`).
5. Changes are **staged and uncommitted** (ship gate).

Until then, `--loop` keeps going (within budgets). In turn mode, “done” is the same checklist; you decide when to ask for a commit.

### Review tools (who runs the panel)

Reviews are **not** free-form chat in the main thread. Separate roles run against the diff. How they are called:

1. **Primary:** your configured host tool’s CLI (`tool` in `harness.local.yaml`)
   - `cursor` → `cursor-agent` or `agent`
   - `claude` → `claude`
   - `codex` → `codex`
2. **Fallback:** HTTP API from `harness/models.yaml`
   - Anthropic (`ANTHROPIC_API_KEY`) for `claude-opus-5` / `claude-sonnet-5` / `claude-haiku-4-5-20251001`
   - or a local OpenAI-compatible endpoint (e.g. Ollama) on the `offline` profile

Which model each role gets comes from the active **profile** in `harness/models.yaml` (default / cheap / offline). Roles never pick their own severity; they return a `category`, and `harness.yaml` maps that to P0–P3.

| Role | When it runs (default) | Default model tier |
| ---- | ---------------------- | ------------------ |
| reviewer | End of every turn | deep (`claude-opus-5`) |
| security | End of unit, and only if the diff hits `securityPaths` | deep |
| product | End of unit, or when `specs/**` / acceptance changed | balanced (`claude-sonnet-5`) |
| qa | End of unit if enabled (off by default) | fast (`claude-haiku-4-5-…`) |
| planner | `--plan` only | deep |
| test-writer / infra | When enabled and relevant | balanced |

See `harness/roles/README.md` for why those tiers exist.

### Exit codes

| Code | Meaning | Who acts |
| ---- | ------- | -------- |
| 0 | pass | proceed |
| 1 | the code is wrong | agent fixes and retries |
| 2 | the harness is wrong (missing tool, bad config, bad flags) | stop and report; never retry as if code is wrong |

### What can refuse

| Moment | What runs | Can refuse? |
| ------ | --------- | ----------- |
| session start | Orientation (git log, handoff, bindings) | no |
| before shell / MCP | Ship gate, `rm -rf`, force push, … | yes (exit 2) |
| after edit | `--edit` tier | no (reports only) |
| stop | `--turn` + review panel | yes (follow-up / block finish) |
| pre-commit | `report.json` must be green + matching tree; explicit ship instruction | yes |

`HARNESS_IN_HOOK=1` stops infinite recursion when a hook calls `verify.sh`.

## Commands

| Command                        | What it does                                                                                     | When to use it                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `./verify.sh`                  | Runs the **commit** tier (edit + turn + commit checks)                                           | Before you ask for a commit, in CI, or as the default "is this green?" |
| `./verify.sh --edit`           | **Edit** tier on changed files (format, lint, context-budget), target under ~1s                  | After a single-file edit; wired to post-edit hooks                     |
| `./verify.sh --turn`           | **Turn** tier (adds types, secrets, unit, env, boundaries, contracts, acceptance, complexity, …) | End of an agent turn, before the panel                                 |
| `./verify.sh --plan`           | Planner decomposes `loop.prd` into `harness/state/plan.json`, then stops                         | When a PRD is ready to split into units/waves                          |
| `./verify.sh --loop`           | Runs the plan wave by wave; ends with work **staged, not committed**                             | Unattended or budgeted implementation against a plan                   |
| `./verify.sh --resume`         | Continues a recorded session; asks on tree drift                                                 | After interrupt, `STOP` file, or budget pause                          |
| `./verify.sh --status`         | Prints resolved profile/tool bindings and current session                                        | Before spending tokens; debugging config                               |
| `./verify.sh --report`         | Session cost/token recap (marks `(estimated)` when needed)                                       | End of session or after the fact                                       |
| `./verify.sh --backlog`        | Renders P2/P3 findings for triage                                                                | Session end triage (keep / discard / promote to spec)                  |
| `./verify.sh --install`        | Detects PM/module/tests, writes baselines, audits practices, wires hooks                         | First setup in a repo (idempotent)                                     |
| `./verify.sh --render`         | Writes the adapter for the **one** configured tool                                               | After changing roles/models/tool; or onboarding a machine              |
| `./verify.sh --render --check` | Exit 1 if generated adapter drifted                                                              | CI drift detection                                                     |
| `./verify.sh --hook`           | Reads hook payload on stdin                                                                      | Only via tool hooks / git pre-commit (not by hand)                     |
| `./verify.sh -h` / `--help`    | Usage                                                                                            | —                                                                      |
| `./verify.sh -v` / `--version` | Version                                                                                          | —                                                                      |

Two action flags together exit `2` naming both. Unknown flags exit `2` and print the list.

## Configuration

Precedence: `harness.local.yaml` (gitignored) > `harness.yaml` > defaults. No flag layer.

```yaml
# harness.local.yaml — required before --render / --plan / --loop
tool: cursor # claude | cursor | codex — exactly one, no default
profile: default # from harness/models.yaml
confirmProfile: true
```

Roles never set severity. They return a `category`; `harness.yaml` maps category → P0–P3.

Review roles: host-tool CLI first (Cursor / Claude Code / Codex), then provider API fallback (`ANTHROPIC_API_KEY` or local OpenAI-compatible endpoint).

### If you change a setting

| Setting               | Default               | What changes                       | When you want the other value                                    |
| --------------------- | --------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `verify.failFast`     | `true`                | Stops at first blocking fail       | `false` in CI to collect all failures                            |
| `review.maxCycles`    | `3`                   | Panel iterations before escalation | Lower to save cost; higher for stubborn P1s                      |
| `review.cadence.turn` | `[reviewer]`          | Roles at end of turn               | Add roles only if budget allows                                  |
| `loop.maxTurns`       | required for `--loop` | Hard stop on agent cycles          | Size to the PRD, not "unlimited"                                 |
| `baseline.*`          | set by `--install`    | Ratchet: fail on growth only       | Lower after a cleanup; never raise casually                      |
| `logs.enabled`        | `false`               | NDJSON event log                   | `true` / `full` when debugging a stuck loop                      |
| `confirmProfile`      | `true`                | Asks before spending on plan/loop  | `false` only in controlled automation (`gate: never` also skips) |

If you cannot write the third column for a knob, make it a constant instead of a setting.

## Layout

```
verify.sh                 # only public executable
AGENTS.md / CLAUDE.md     # guides (append, never replace wholesale)
HANDOFF.md                # living session notes, newest first
harness.yaml              # shared behaviour
harness.local.yaml        # per developer (gitignored)
harness/
  models.yaml             # only file that names models
  roles/ rules/ skills/
  sensors/                # sensors.yaml + checks/ + guidance/
  enforce/ render/ state/ # state is gitignored
specs/<slug>/PRD.md
docs/adr/
examples/two-services/    # deletable demo estate
```

| Path | Role |
| ---- | ---- |
| `verify.sh` | Single entry point for tiers, plan/loop, install, render, and hooks |
| `AGENTS.md` / `CLAUDE.md` | Standing instructions for the coding agent (`CLAUDE.md` points at `AGENTS.md`) |
| `HANDOFF.md` | Short session notes the next agent (or human) reads first |
| `harness.yaml` | Shared, committed behaviour: roles, severity, baselines, hooks default |
| `harness.local.yaml` | Per-machine tool and profile; never committed |
| `harness/models.yaml` | Provider and model IDs only; roles pick tiers, not model strings |
| `harness/roles/` | Reviewer / planner / security prompts rendered into the tool adapter |
| `harness/rules/` | Standing constraints copied into agent context |
| `harness/skills/` | Step-by-step playbooks (ADR, PRD, session start) linked into `.cursor` / `.claude` |
| `harness/sensors/` | Registry (`sensors.yaml`), thin shell checks, and failure guidance |
| `harness/enforce/` | Ship gate, pre-tool refuse, stop/edit hook logic |
| `harness/render/` | Tool adapters (Cursor / Claude / Codex templates and hook scripts) |
| `harness/state/` | Machine output: `report.json`, plan, session, backlog (gitignored) |
| `specs/<slug>/` | PRD plus `acceptance.json` for a piece of work |
| `docs/adr/` | Architecture decisions that outlive a unit |
| `examples/two-services/` | Optional demo monorepo to try boundaries and checks |

## Review panel

At turn end: turn-tier checks + **reviewer** only (cheap).

At unit end (and before commit): full panel from `review.cadence.unit`, filtered by path triggers in `harness.yaml`.

Roles return categories only. Config maps them to severity. P0/P1 block. P2/P3 go to `harness/state/backlog.json` (shown at session end). A category that shows up across three or more units is written to `harness/state/proposed-rules.md`.

## Ship gate

Independent of `gate` and `--loop`:

- Commit, push, PR, and deploy require an explicit developer instruction in the session.
- Non-interactive runs **refuse** those actions (no hang, no silent proceed).
- A completed `--loop` leaves work **staged and uncommitted**.
- `HARNESS_BYPASS=<reason>` logs to `harness/state/bypass.log` and expects a `Harness-Bypass:` trailer.

## Non-interactive prompts

| Prompt                      | Interactive | Non-interactive                                      |
| --------------------------- | ----------- | ---------------------------------------------------- |
| `--install` tool choice     | asks        | detect `.cursor` / `.claude` / `.codex`, else exit 2 |
| Profile confirmation        | asks        | skipped; assignment written to log/stderr            |
| Split recommendation        | asks        | record and proceed                                   |
| Commit / push / PR / deploy | asks        | **refuses**                                          |

## Complexity check

Turn-tier `complexity` runs eslint's `complexity` rule on changed files. With `baseline.maxComplexity` from `--install`, it fails on **growth only** (same ratchet pattern as `context-budget` and `duplication`).

## Copying into another repo

1. Copy `verify.sh`, `harness/`, and optionally `harness.yaml` into the repo root.
2. `npm install yaml` (or keep this package.json dependency).
3. Run `./verify.sh --install` and set `tool` in `harness.local.yaml`.
4. Commit shared files; keep `harness.local.yaml` and `harness/state/` private. Exception: commit `.cursor/hooks.json` if you use Cursor cloud agents.

## Recovering from a wedged Cursor hook

If every agent tool fails with `Hook … --hook`:

1. Clear the adapter (one-liner):
   ```bash
   echo '{"version":1,"hooks":{}}' > .cursor/hooks.json
   ```
2. **Developer: Reload Window**.
3. Fix the underlying issue (see `harness/render/cursor/HOOKS.md`), then `./verify.sh --render`.

Hooks default to **on**. Prefer narrowing matchers over `hooks.enable: false`. Optional MCP gating lives under `harness/render/cursor/optional/`.

Thin hook scripts are **bash → `verify.sh` only** (no Node in the adapter).

Details: [`harness/render/cursor/HOOKS.md`](harness/render/cursor/HOOKS.md).

## License

[MIT](LICENSE)
