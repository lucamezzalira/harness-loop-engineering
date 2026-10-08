# Loop failure modes (and how the harness closes them)

Hardening learned from production loop runs. Each row is a failure that burned
turn budget before the fix landed. Pointers are to modules in this repo.

| Failure | What happens | Fix | Code |
| --- | --- | --- | --- |
| Bad plans burn the budget | Planner invents `touches` (e.g. `init/src/**`) or writes `A-01: prose` that never matches `acceptance.json` | Normalize acceptance to bare `A-NN`; validate plan before `--loop`; fail closed | `harness/lib/plan/acceptance-id.mjs`, `validate-plan.mjs` |
| Units that cannot complete never stop | Missing touch evidence or never-passable acceptance keeps calling implementers | Stall → status `unclosable` (terminal); hand off to a human | `harness/lib/plan/loop.mjs` (`shouldStallUnit`, `unitStallLimit`) |
| Turn panels spin | After `review.maxCycles`, the same unit’s turn panel keeps re-running | Cap turn panels per unit (`turnPanelCapped`) | `harness/lib/enforce/stop.mjs` |
| Full monorepo tests every turn | Turn-tier unit sensor re-runs `npm test` for the whole tree | Scope from `HARNESS_CHANGED_FILES`; empty list → full suite | `harness/lib/checks/scope-tests.mjs`, `sensors/checks/unit.sh` |
| Cadence too late / too heavy | Product and security only appear on a final mega-panel | Unit end owns security+product; wave/ship keep specialists | `harness.yaml` `review.cadence`, `panel/dispatch.mjs` |
| Ship panel blocks with nowhere to go | Final panel exits 1; resume replays all waves | `stopReason: ship-panel-blocking` resumes ship only | `loop.mjs` (`shouldResumeLoop`, skip waves when all terminal) |
| Local models cannot edit | Offline / local roles return text only; tree never changes | Hybrid profile: local reviewers, host-tool implementers | `harness/models.yaml` `hybrid-local` |

## Config knobs

| Knob | Default | Meaning |
| --- | --- | --- |
| `loop.unitStallFactor` | `2` | Stall after about `estimatedTurns * factor` when files exist but the unit never completes |
| `loop.unitStallGraceTurns` | `0` | Extra turns added to the stall ceiling |
| `review.maxCycles` | `3` | Turn-panel retries before cap / escalation |
| `HARNESS_UNIT_FULL=1` | unset | Force full `npm test` even when changed files are set |

## Out of scope for the blueprint

Domain specialists (portfolio `aws` / `react` roles), exact Ollama tags, and
product trees belong in the consuming repo or a future plugin layer. This doc
only covers generic loop hygiene.
