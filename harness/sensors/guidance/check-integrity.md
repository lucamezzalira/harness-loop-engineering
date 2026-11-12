# check-integrity

## Why this exists

The agent can rewrite a check until the check goes green, or skip hooks from the shell. This sensor reads the diff, which `pre_tool` cannot see when the edit arrives through `sed` or a redirect.

## What to do

1. Put the test back, or drop the skip, the exclusive focus, and the suppression comment.
2. A change under a protected check path needs an explicit developer instruction in this session.
3. On your own terminal, run `./verify.sh --allow-check-edit`. It asks which `protect.checkPaths` globs the change covers (or `all`) and a one-line reason, then records `explicitCheckEdit` on `harness/state/session.json`.
4. The record matches only those paths. It expires when the loop finishes, when `--resume` starts a new session, or after 12 hours.
5. Re-run `./verify.sh --turn`.

Protected paths are `protect.checkPaths` in `harness.yaml`. The list includes the sensors, the enforce and check modules, `verify.sh`, `harness.yaml`, and lint, tsconfig, prettier, and stryker config files.
