# report-present

## Why this exists

A spec can mark every acceptance entry passing while the claim was never checked against the PRD. This sensor reads every `A-NN` id in `specs/<slug>/PRD.md` and requires that id in `acceptance.json` with `passes: true`, and in the `## Criteria` section of `REPORT.md`. A line `Deferred: A-NN (reason)` takes that id out of scope. An open spec whose ids are all still `passes: false`, and which has no report, is not a completed claim. When every entry has `passes: true`, the report must end with the line `acceptance-checker: PASS`.

## What to do

1. Write `specs/<slug>/REPORT.md` with the four sections in `harness/skills/report-against-prd/SKILL.md`: criteria, wiring proof, bypass check, and known gaps.
2. Have the acceptance checker review it. Only a PASS line is appended.
3. Re-run `./verify.sh`.

The sensor does not stop a person who writes the PASS line without a review. It stops a finished spec that has no reviewed report.
