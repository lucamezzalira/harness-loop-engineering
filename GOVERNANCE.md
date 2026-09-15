# Governance

What leaves the machine, what stays local, and what a regulated deployment
would change. This lives at the repo root because it is the first question a
platform team asks.

## Per tool

| Tool        | What leaves the machine by default                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Prompts, tool results, and file contents the agent reads, sent to Anthropic per your account settings                                                                           |
| Cursor      | Same class of data to Cursor and the configured model provider. Project hooks in `.cursor/hooks.json` also run for cloud agents, so enforcement follows the work off the laptop |
| Codex       | Not wired here yet. See `.codex/README.md`                                                                                                                                      |

The harness does not add a second exfiltration path of its own, except when
`trace.level` is `full` and you copy the trace off the box.

## Eval fixtures

`eval/fixtures/` holds recorded role outputs keyed by a hash of task, role,
model, and repeat index. They are structured findings, not raw chain-of-thought,
but they can still name files and line ranges from the seeded tasks. Scrub or
regenerate them before publishing a fork that uses private application code as
a fixture source. `eval/results/runs.jsonl` is committed history of scores, not
prompts.

## Tracing

`trace.enabled` defaults to false. `trace.level: events` records lifecycle,
decisions, verdicts, and verify results. `trace.level: full` also stores tool
payloads and file contents. Full traces contain your source. Keep them under
`.harness/trace/` (gitignored), rotate with `trace.retainSessions`, and treat
a full trace as sensitive as a production log dump.

## Regulated deployments

A deployment that cannot send source to a third-party model would: run models
inside the boundary, keep `trace.level` at `events` or off, scrub eval fixtures
of customer identifiers, and review `HARNESS_BYPASS` usage via `.harness/bypass.log`
and commit trailers. The break-glass path is intentional. Auditable beats
forbidden, because the alternative is someone deleting the hook config at two
in the morning and never restoring it.
