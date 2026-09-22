---
id: "0005"
title: "Sensors declare where they run via HARNESS_ENV"
status: accepted
date: 2026-09-22
deciders:
  - Luca Mezzalira
tags:
  - sensors
  - ci
touches:
  - harness/sensors/sensors.yaml
  - harness/lib/checks/**
  - harness/lib/cli.mjs
  - .github/workflows/**
supersedes: []
superseded-by: ""
related:
  - "0003"
---

# ADR 0005: Sensors declare where they run via HARNESS_ENV

## Context and problem

Sensors had tier and missing-tool policy but not environment scope. CI-only
checks relied on `missing: skip` when tools were absent locally, which failed
as soon as a developer installed the tool for debugging.

## Decision drivers

- Explicit environment beats inferring `$CI` / `$GITHUB_ACTIONS`
- Most sensors run everywhere; omitting a CI check is worse than running one
  locally by accident
- Thin shell sensors stay under the executable-line budget

## Considered options

1. Keep gating on tool absence (`missing: skip`)
2. Infer CI from provider env vars
3. Required `where: [local] | [ci] | [local, ci]` plus explicit `HARNESS_ENV`

## Decision outcome

Chosen option: 3.

- Unset `HARNESS_ENV` means `local`
- Runner filters by `where` before tier
- `where: []` is a configuration error
- CI workflows set `HARNESS_ENV=ci` at the job level

## Consequences

### Positive

- SAST and similar checks are CI-only by design
- Local-only session-state checks do not noise CI
- Reports list deferred CI sensors and skipped local-only sensors

### Negative

- Every workflow must set `HARNESS_ENV=ci` or CI-only sensors never run

## How the agent applies this

- Add `where` on every new sensor entry
- Never infer environment from `$CI`
- Put CI-only tool installs in the workflow, not in local docs alone

## Revisit when

- A third harness environment is genuinely required
- Provider-specific matrixes (Linux CI vs Windows CI) become necessary
