---
id: "0006"
title: "Host tools are Cursor and Claude"
status: accepted
date: 2026-11-12
deciders:
  - Luca Mezzalira
tags:
  - render
  - tools
touches:
  - harness/lib/render/**
  - harness/lib/config.mjs
  - harness/lib/install.mjs
  - "**/README.md"
  - "**/AGENTS.md"
supersedes: []
superseded-by: ""
related:
  - "0001"
  - "0004"
---

# ADR 0006: Host tools are Cursor and Claude

## Context and problem

The harness renders one adapter per run. Two host tools are in use: Cursor and
Claude Code. A third host was specified early and never wired into a maintained
adapter. Keeping a dead branch in render, install, and the docs makes the
single-target rule harder to check.

## Decision drivers

- `./verify.sh` stays the only entry point (ADR 0001).
- Rule source stays Cursor-shaped markdown under `harness/render/rules/` (ADR 0004).
- One render run writes one tool directory.

## Considered options

1. Keep a third adapter that nobody renders.
2. Support Cursor and Claude only, and exit 2 when config names anything else that used to be listed.

## Decision outcome

Chosen option: 2. Supported tools are `cursor` and `claude`. `VALID_TOOLS` lists
those two. Render writes `.cursor/` or `.claude/`. Config that names the retired
host exits 2 with a fixed error string.

Accepted ADRs 0001 and 0004 still mention the retired host in their original
decision text. This ADR does not supersede them. Their historical sentences stay.

## Consequences

### Positive

Install, render, and the docs describe the two tools the hooks actually serve.

### Negative

Old notes that name a third host are historical. New text does not repeat that name.

## How the agent applies this

- Before changing files matching `touches`, read this ADR in full.
- Do not add a third tool directory, installer prompt, or render branch.
- Do not edit accepted ADRs 0001 or 0004 to scrub old wording. Point at this ADR instead.
