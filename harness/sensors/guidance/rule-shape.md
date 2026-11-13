# rule-shape

## Why this exists

Standing rules under `harness/render/rules/` are the source `./verify.sh --render` copies into the tool adapter. A rule that drops the required shape drifts from that contract.

## What to do

1. Match the template in `harness/render/rules/TEMPLATE.md`.
2. Re-run `./verify.sh --turn`.

The check is `scripts/check-rule-shape.mjs`, started by `harness/sensors/checks/rule-shape.sh`.
