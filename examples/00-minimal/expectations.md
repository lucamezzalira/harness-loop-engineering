# Expectations (written before any run)

These predictions are the experiment design. Update the results section only
after a recorded run. Do not rewrite the predictions to match the outcome.

## Expected to fix

Most functional defects that a unit test or a careful read of the mailer and
subscribe path would expose:

- D1 (check-then-insert race on subscribe)
- D2 (welcome email not idempotent on retry)
- D5 (failed send acked and dropped)
- D6 (validation accepts addresses the transport rejects)

## Expected to miss

- D3 (email-service deep-imports subscription-service internals). Nothing in the
  prompt names the boundary, and no test in the minimal prompt encodes it. The
  model has no reason to treat that import as wrong.

## Strengthens the case further if also missed

- D4 (subscriber email written to an info log). Privacy is easy to overlook when
  the task is framed as "make welcome email work."

## Why this control exists

Published harness comparisons show minimal agents competing with, and sometimes
beating, feature-heavy ones on SWE-bench-style tasks that already have a perfect
hidden oracle. A repo that argues for structure without shipping the unstructured
baseline is not credible. Whatever this run actually does, including results that
do not flatter the harness, is the finding.

## Results

_No run recorded yet._
