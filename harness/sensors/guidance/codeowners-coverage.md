# codeowners-coverage

## Why this exists

`protected-change` can only find an owner when `CODEOWNERS` names one. A protected glob with no line has nobody to approve it.

## What to do

1. Add a line to `.github/CODEOWNERS` for each glob in `protect.checkPaths` and `review.humanRequired.paths`.
2. Put a broad glob above the more specific globs it covers. GitHub uses the last matching line, so `harness/**` last would override every `harness/...` rule above it.
3. Re-run `./verify.sh --turn`.

The check is `harness/lib/checks/codeowners-coverage.mjs`.
