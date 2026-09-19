# AGENTS.md

## Commands

- `./verify.sh` — commit-tier checks (default)
- `./verify.sh --edit` — edit tier on the file just changed
- `./verify.sh --turn` — turn tier
- `./verify.sh --plan` / `--loop` / `--resume` — plan and run
- `node --test harness/lib/**/*.test.mjs` — harness unit tests
- `cd examples/two-services && npm test` — example estate tests

## Testing

Mock I/O at the edges. Prefer `node:test`. Do not mock the unit under test.

## Structure

- `harness/` — editable harness (roles, rules, skills, sensors)
- `harness/state/` — machine output (gitignored)
- `examples/two-services/` — runnable estate for trying checks

## Style

Follow eslint. No style rules here that the linter already enforces.

## Git workflow

The agent must not commit, push, open a PR, or deploy without an explicit developer instruction in the current session.

## Boundaries

- Always do: read, lint, run unit tests on a touched file.
- Ask first: add a dependency, change the lockfile, write a migration, publish a new event type, change a public route.
- Never touch: production config, credentials, configured infra paths.

<!-- harness-loop-engineering -->

## Harness

Run `./verify.sh` (edit/turn/commit tiers via flags). Exit codes: 0 pass, 1 fix code, 2 fix harness (never retry 2 as if code is wrong).
Nothing ships (commit/push/PR/deploy) without an explicit developer instruction in the session.
<!-- /harness-loop-engineering -->
