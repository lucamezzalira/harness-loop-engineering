# report-present

## Why this exists

A spec can mark every acceptance entry passing while the claim was never checked against the PRD. This sensor reads `specs/<slug>/acceptance.json`. When every entry has `passes: true`, it requires `REPORT.md` in that folder, and the file must end with the line `acceptance-checker: PASS`.

## What to do

1. Write `specs/<slug>/REPORT.md` with the four sections in `harness/skills/report-against-prd/SKILL.md`: criteria, wiring proof, bypass check, and known gaps.
2. Have the acceptance checker review it. Only a PASS line is appended.
3. Re-run `./verify.sh`.

The sensor does not stop a person who writes the PASS line without a review. It stops a finished spec that has no reviewed report.
