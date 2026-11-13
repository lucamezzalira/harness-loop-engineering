---
id: "0007"
title: "CI decides protected changes"
status: accepted
date: 2026-11-13
deciders:
  - Luca Mezzalira
tags:
  - ci
  - review
touches:
  - .github/workflows/**
  - harness/lib/checks/protected-change.mjs
  - harness/lib/enforce/pre_tool.mjs
supersedes: []
superseded-by: ""
related:
  - "0003"
  - "0005"
---

# ADR 0007: CI decides protected changes

## Context and problem

A local approval record is only as strong as the hook that recorded it. Cursor does not send a before-write hook, so a Write of session state never hits that guard. The pull request is the place a second person, or the solo-maintainer label, can be checked.

## Decision drivers

- The check has to run where the merge happens.
- The same command has to work for Cursor and Claude Code. Nothing in the decision may depend on either tool.
- A new push must not keep an approval that belonged to the previous head.

## Considered options

1. Keep the local session record as the decision.
2. Decide in CI, on the pull request, and treat local hooks as an early warning.
3. Support several CI providers in the same change.

## Decision outcome

Chosen option: 2. The `protected-change` sensor, running in GitHub Actions, decides whether a protected change on the pull request was approved. Only GitHub Actions is supported. Local hooks remain an early warning. This ADR supersedes nothing.

A solo maintainer adds the label `protected-change-approved`. A synchronize event clears it before verify reads the pull request, and a labeled event older than `pull_request.updated_at` does not count.

The ship gate refuses push, pull-request create, label, review, and merge commands unless the developer gave an explicit instruction. If the agent can reach the developer's GitHub token, GitHub cannot tell them apart. That limit is accepted. Tokens stay out of the agent's environment.

Turning on branch protection, so a red check can block the merge, is optional and is not part of this decision.

## Consequences

### Positive

- A clean clone and a pull request see the same decision.
- A stale label from before the push cannot approve the new head.

### Negative

- Without branch protection, a red check warns and does not stop a merge.
- Providers other than GitHub Actions are unsupported.

## How the agent applies this

- Before changing `.github/workflows/**`, `protected-change.mjs`, or `pre_tool.mjs`, read this ADR in full.
- Do not add another CI provider without a superseding ADR.
- Do not treat the local approval record as the decision.
