# 10-newsletter

Two small TypeScript services and a shared contracts package. This is the system
the harder harness lessons and the component eval score against.

## Goal

Show that fitness functions catch classes of defect that more tests will not.
The featured case is D3: `email-service` deep-imports a `subscription-service`
internal module. Lint, types, and unit tests stay green. Only stage
`55-service-boundaries` fails.

## Setup

From the repo root:

```bash
scripts/scenario.sh start 10-newsletter
cd ../.scenarios/10-newsletter
# VERIFY_STAGES is written into .env.local by scenario.sh
set -a && source .env.local && set +a
scripts/verify.sh commit
```

Or without a worktree:

```bash
VERIFY_STAGES=examples/10-newsletter/.verify/stages scripts/verify.sh commit
```

Apply a planted defect with `git apply examples/10-newsletter/defects/D3.patch`
(from the worktree or repo root), then re-run verify and watch the named stage
fail. Reset with `git checkout -- examples/10-newsletter` or
`scripts/scenario.sh reset 10-newsletter`.

Services talk over an in-process event bus from `packages/contracts`. A
file-backed bus lives beside it when you want two processes. No database, no
broker, no containers.

## What to watch

- `packages/contracts` is the only permitted cross-service dependency.
- Stage `55-service-boundaries` runs dependency-cruiser with that rule.
- Stage `56-contracts` checks that `SubscriberConfirmed` matches the shared schema.
- The defect catalogue in `defects.yaml` is also the reviewer eval ground truth.

## What usually goes wrong

Agents "fix" D3 by duplicating a type or moving the import behind a dynamic
`import()`, which still couples the services. The right fix is to keep the
event payload self-contained and delete the cross-service import. Another common
miss is treating a green unit suite as proof the architecture held.
