# report.json schema

Written by `./verify.sh` after every check run to `harness/state/report.json`.

| Key | Type | Meaning |
| --- | ---- | ------- |
| `tier` | `edit` \| `turn` \| `commit` \| `manual` | Which sensor tier ran |
| `status` | `pass` \| `fail` \| `harness-error` | Overall result. Warnings alone still yield `pass` |
| `hasWarnings` | boolean | True when any check returned `warn` (non-blocking fail or `missing: warn`) |
| `treeHash` | string | Content hash of the tree at report time (ship gate compares this) |
| `durationMs` | number | Wall time for the check run |
| `checks` | array | Per-sensor results (see below) |

## checks[] entry

| Key | Type | Meaning |
| --- | ---- | ------- |
| `name` | string | Sensor name from `sensors.yaml` |
| `status` | `pass` \| `fail` \| `warn` \| `skipped` \| `harness-error` | Outcome after registry mapping |
| `exitCode` | number? | Process exit when relevant (`2` = harness error) |
| `reason` | string? | Short reason (skips / missing tools) |
| `output` | string? | Tool output (blocking fails include guidance preamble) |
| `durationMs` | number | Time for this check |

No other top-level keys are written. Consumers must ignore unknown keys forward-compatibly.
