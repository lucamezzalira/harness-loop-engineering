# doc-drift

## Why this exists

Docs name flags, sensors, roles, skills, and config keys that the code no longer has, or they link to a path that was moved. This sensor fails the turn when that happens.

## What to do

1. Add the missing README row, guidance file, role row, or skill name. Or remove the flag, sensor, role, skill, or key that the doc invented.
2. Fix the relative link so it points at a file or directory that exists.
3. Re-run `./verify.sh --turn`.

It checks `harness/lib/cli.mjs` against the README commands table, `harness/sensors/sensors.yaml` against `harness/sensors/guidance/<name>.md` and the README, enabled roles in `harness.yaml` against `harness/roles/README.md`, skill folders against the README, top-level `harness.yaml` keys against the README configuration section, and relative links in tracked markdown. When `docs/guide.md` exists, it also fails if a `./verify.sh` code block uses a flag the CLI does not accept, if the guide omits a flag the CLI accepts, or if the README does not link to the guide in its first 40 lines.
