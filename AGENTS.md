# Harness and Loop Engineering

Reference implementation for a Node harness that renders for Claude, Cursor and Codex.
JavaScript (ESM) on Node 20+, npm.

## Setup commands
- Install: `npm install`
- Test: `npm test`
- Test one file: `node --test path/to/file.test.mjs`
- Verify (the harness itself): `./verify.sh`
- Plan / loop: `./verify.sh --plan` then `./verify.sh --loop`

## What done means
A change is done when `./verify.sh` exits 0. That means the panel of
review roles has run at the tier the change requires, no P0 or P1
findings remain open, and the ship gate still requires an explicit
developer instruction before commit, push, PR, or deploy. A change that
only compiles is not done.

## Project structure
- `harness/` the harness itself; keep it visible, not hidden under a dot
- `harness/sensors/checks/` thin shell sensors (exit 0/1/2/3; registry owns missing)
- `harness/roles/` the review roles
- `harness/render/rules/` standing constraints (template + rule-shape sensor)
- `harness/state/` gitignored session and cost state
- `docs/adr/` architecture decisions, indexed at docs/adr/README.md
- `specs/` per-feature PRDs and acceptance.json
- `.claude/`, `.cursor/`, `.codex/` rendered from harness/render/

## Architecture
The standing decisions live in `docs/adr/`. Read `docs/adr/README.md`
first to find the ADRs whose `touches` field matches the paths you are
about to change, then read those ADRs in full before making the change.
The short version, for tasks that do not touch architectural boundaries:

- Verify.sh is the sole entry point; flags select action, never carry
  configuration
- Exit codes are three-valued at the CLI: 0 pass, 1 code wrong, 2 harness wrong
  (sensors may also return 3 for missing tool; sensors.yaml maps that)
- Roles return a `category` from a closed list, and harness.yaml maps
  category to severity

For anything beyond these lines the ADR is the source of truth.

## Boundaries
- Never edit files under `harness/state/`, it is regenerated per session
- Never modify an ADR whose status is `accepted`; supersede with a new
  ADR instead
- Never install a new production dependency without an ADR
- Never render for more than one tool in a single run; the single-target
  rule is load-bearing
