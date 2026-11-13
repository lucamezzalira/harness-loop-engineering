---
name: report-against-prd
description: Use before telling the developer a PRD is done. Write the report, then have the acceptance checker review it.
---

Ask nothing. Read the PRD, `acceptance.json`, and the diff. Write `specs/<slug>/REPORT.md` with these four sections, in this order:

1. **Criteria.** One row per acceptance ID. Name the test, say whether that test drives the real entry point or a helper on its own, name the code path (file and line), and record the last green run.
2. **Wiring proof.** For every new flag, field, or record the code reads, name the place that writes it. A read with no writer is a FAIL.
3. **Bypass check.** For every new protection, list the shell route, the state-file route, and the flag route. Each route names the test that blocks it. A route with no test is a FAIL, or a known gap when the developer has accepted it.
4. **Known gaps and rerun commands.** What could not be verified, what was assumed, and the exact commands that reproduce the evidence.

Then run the acceptance checker on that file against the PRD, `acceptance.json`, and the diff. The checker appends one line: `acceptance-checker: PASS` or `acceptance-checker: FAIL` with reasons. Share only a report that ends in `acceptance-checker: PASS`. A FAIL goes back to the implementer.

CI `protected-change` decides a protected change on the pull request. This file does not.
