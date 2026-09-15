#!/usr/bin/env bash
# scripts/loop.sh
# Explicit driver for unattended runs. Thin client of the same verify.sh the
# hooks use. Requires loop.goal and loop.maxTurns. No other setting in the
# repo is mandatory.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"

usage() {
  cat <<'EOF'
Usage: scripts/loop.sh
       scripts/loop.sh --resume
       scripts/loop.sh --status
       scripts/loop.sh -h|--help
       scripts/loop.sh -v|--version

No flag takes a value. Combining any two action flags is an error.
Anything scripted should read .harness/loop-state.json rather than parse
this output.

Config (loop.*)
  goal                    REQUIRED. Path to a PRD file, or a one-line objective
                          in quotes.
  maxTurns                REQUIRED. Hard stop in agent turns, counted at the
                          stop event. Verification retries and reviewer cycles
                          happen inside a turn and do not count toward it.
  maxSeconds              default 1800. Wall clock budget. First budget reached
                          stops the loop.
  maxCostUsd              default 5.00. Spend budget.
  gate                    default on-commit. never | each-turn | on-commit.
  stopOnIdenticalFailures default 2. Consecutive turns with the same failing
                          stage and an unchanged tree hash before the loop
                          concludes the agent is stuck.
  confirmOnTreeDrift      default true. Ask before resuming onto a tree that
                          changed since the loop stopped.

--resume  continue the run in .harness/loop-state.json
--status  print current run state and resolved config, then exit 0
EOF
}

harness_parse_flags --resume --status -- "$@"
if [[ "${HARNESS_CLI_HELP}" -eq 1 ]]; then
  usage
  exit 0
fi
if [[ "${HARNESS_CLI_VERSION}" -eq 1 ]]; then
  harness_print_version_and_exit
fi

harness_config_load "$HARNESS_ROOT"

action="run"
if [[ ${#HARNESS_CLI_ACTIONS[@]} -gt 0 ]]; then
  action="${HARNESS_CLI_ACTIONS[0]}"
fi

if [[ "$action" == "--status" ]]; then
  echo "no run in progress"
  echo
  harness_config_print_resolved
  exit 0
fi

harness_config_require_loop

# T13 fills in the driver. Requiring loop.goal and loop.maxTurns is the T03
# contract: without the config file this script exits 2 with the 4.3 message.
echo "loop: goal=$(harness_config_get loop.goal) maxTurns=$(harness_config_get loop.maxTurns)" >&2
echo "loop: driver not yet installed" >&2
exit 0
