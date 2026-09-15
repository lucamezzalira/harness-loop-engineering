# Eval

On demand only. Nothing in `eval/` is wired to a hook. You run it when you want
to know whether a role still performs after changing its model or its prompt.

This is a different mechanism from the reviewer-in-the-loop stop hook. They share
a role definition and nothing else. The stop hook feeds findings back into a
live turn. This suite scores roles against seeded tasks and writes rows to
`results/runs.jsonl`.

## Why no LLM eval framework

The scoring here has ground truth, so the judge-based metrics those frameworks
exist to provide would add nondeterminism to the one part of the system whose
purpose is being deterministic. DeepEval now has a TypeScript SDK and Evalite is
the local-first TypeScript option. The choice to stay on vitest scorers and set
arithmetic is deliberate.

## Invocation field

Every row records `invocation: direct`. `--agents <role>` (or the equivalent
headless call) invokes the role directly. In a real session the role is reached
by delegation and returns a summary to the main thread rather than its raw
output. The published numbers therefore describe direct invocation. Delegation
adds a summarisation step this suite does not measure. The field exists so a
Phase 2 delegated variant can land without a schema migration.

## Sensitivity

With six planted defects and three repeats, the suite detects a clearly worse
model and cannot detect a five percent difference. Saying so is more useful than
a bare number.

## Replay vs live

Replay (default) reads `fixtures/` so CI and attendees without an API key still
see the numbers move. Set `HARNESS_EVAL_LIVE=1` to invoke models and record new
fixtures.

```bash
eval/run.sh
```

Moving `reviewer` from `deep` to `fast` in `eval/models.yaml` and re-running
produces a visibly different recall against the newsletter defects.
