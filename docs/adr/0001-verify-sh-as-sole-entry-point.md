---
id: "0001"
title: "verify.sh is the sole public entry point"
status: accepted
date: 2026-09-22
deciders:
  - Luca Mezzalira
tags:
  - harness
  - entry-point
touches:
  - "**/verify.sh"
  - harness/lib/cli.mjs
  - harness/render/**
supersedes: []
superseded-by: ""
related: []
---

# ADR 0001: verify.sh is the sole public entry point

## Context and problem

Coding agents and humans need one stable way to run checks, plan work, render
tool adapters, and honor hooks. Multiple entry scripts or flag-carried config
would fork behaviour per tool and make exit codes ambiguous.

## Decision drivers

- One binary for Cursor, Claude Code, Codex, CI, and git hooks
- Configuration lives in YAML, not on the command line
- Exit codes must distinguish code-wrong from harness-wrong

## Considered options

1. Per-tool scripts (`.cursor/verify`, `claude-verify`, …)
2. npm scripts that wrap different Node entry files
3. A single `./verify.sh` that dispatches into `harness/lib/cli.mjs`

## Decision outcome

Chosen option: 3. `./verify.sh` is the only public executable. Flags select the
action (`--edit`, `--turn`, `--plan`, `--loop`, `--render`, `--hook`, …).
Parameters come from `harness.yaml` and `harness.local.yaml`.

## Consequences

### Positive

- Hooks stay thin: they only `exec ./verify.sh --hook`
- CI and agents share the same path and exit-code contract

### Negative

- New behaviour must land behind a flag or config key, not a second binary

## How the agent applies this

- Always invoke `./verify.sh` (with at most one action flag).
- Never add a second public CLI for harness behaviour.
- Treat exit `2` as harness-wrong: stop and report, do not retry as a code fix.

## Revisit when

- A non-Node host must run the harness without a shell wrapper
- Action flags can no longer express the surface without becoming a config DSL
