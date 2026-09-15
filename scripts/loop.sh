#!/usr/bin/env bash
# scripts/loop.sh
# Explicit driver for unattended runs. Thin client of the same verify.sh the
# hooks use. Requires loop.goal and loop.maxTurns.
#
# A session that compacted before stopping may resume with a thinner memory of
# its plan. The trace snapshot is what lets you see that happened.
#
# There is no task backlog. The agent owns what to do; the harness owns whether
# it may continue and when it must stop.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"
# shellcheck source=lib/treehash.sh
source "$HARNESS_ROOT/scripts/lib/treehash.sh"

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

STATE_FILE="$HARNESS_ROOT/.harness/loop-state.json"
STOP_FILE="$HARNESS_ROOT/.harness/STOP"

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

read_state() {
  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE"
  else
    echo '{}'
  fi
}

write_state() {
  mkdir -p "$(dirname "$STATE_FILE")"
  printf '%s\n' "$1" >"$STATE_FILE"
}

if [[ "$action" == "--status" ]]; then
  state="$(read_state)"
  if ! jq -e '.goal' <<<"$state" >/dev/null 2>&1; then
    echo "no run in progress"
  else
    echo "run in progress"
    jq -r '
      "  goal:           \(.goal)",
      "  sessionId:      \(.sessionId // "")",
      "  turns:          \(.turns)/\(.maxTurns // "?")",
      "  elapsedSeconds: \(.elapsedSeconds)",
      "  costUsd:        \(.costUsd)",
      "  stopRetries:    \(.stopRetries)",
      "  reviewCycles:   \(.reviewCycles)",
      "  lastFailing:    \(.lastFailingStage // "")",
      "  stoppedReason:  \(.stoppedReason // "")",
      "  resumable:      \(.resumable)"
    ' <<<"$state"
  fi
  echo
  harness_config_print_resolved
  exit 0
fi

harness_config_require_loop

goal="$(harness_config_get loop.goal)"
max_turns="$(harness_config_get loop.maxTurns)"
max_seconds="$(harness_config_get loop.maxSeconds)"
max_cost="$(harness_config_get loop.maxCostUsd)"
gate="$(harness_config_get loop.gate)"
stop_identical="$(harness_config_get loop.stopOnIdenticalFailures)"
confirm_drift="$(harness_config_get loop.confirmOnTreeDrift)"

ORIGIN_EPOCH="$(date +%s)"

stop_loop() {
  local reason=$1
  local state elapsed
  elapsed=$(( $(date +%s) - ORIGIN_EPOCH ))
  state="$(read_state)"
  # On resume, add prior elapsed stored before this process started.
  local base
  base="$(jq -r '.elapsedBase // 0' <<<"$state")"
  elapsed=$((elapsed + base))
  state="$(jq -c \
    --arg r "$reason" \
    --arg h "$(harness_treehash "$HARNESS_ROOT")" \
    --argjson e "$elapsed" \
    '.stoppedReason=$r | .treeHashAtStop=$h | .elapsedSeconds=$e | .resumable=true' \
    <<<"$state")"
  write_state "$state"
  echo "loop: stopped (${reason})" >&2
  exit 0
}

trap 'stop_loop "SIGINT"' INT

invoke_agent_turn() {
  if [[ -n "${HARNESS_AGENT_CMD:-}" ]]; then
    eval "$HARNESS_AGENT_CMD"
    return $?
  fi
  echo "loop: no HARNESS_AGENT_CMD; simulating turn" >&2
  return 0
}

check_stop_file() {
  if [[ -f "$STOP_FILE" ]]; then
    stop_loop "STOP"
  fi
}

check_budgets() {
  local state turns elapsed cost
  state="$(read_state)"
  turns="$(jq -r '.turns' <<<"$state")"
  elapsed=$(( $(date +%s) - ORIGIN_EPOCH + $(jq -r '.elapsedBase // 0' <<<"$state") ))
  cost="$(jq -r '.costUsd' <<<"$state")"
  check_stop_file
  if (( turns >= max_turns )); then
    stop_loop "maxTurns"
  fi
  if (( elapsed >= max_seconds )); then
    stop_loop "maxSeconds"
  fi
  if python3 -c "import sys; sys.exit(0 if float('${cost}') >= float('${max_cost}') else 1)"; then
    stop_loop "maxCostUsd"
  fi
}

if [[ "$action" == "--resume" ]]; then
  if [[ ! -f "$STATE_FILE" ]] || ! jq -e '.goal' "$STATE_FILE" >/dev/null 2>&1; then
    echo "loop: nothing to resume" >&2
    exit 2
  fi
  if [[ "$confirm_drift" == "true" ]]; then
    prev="$(jq -r '.treeHashAtStop // empty' "$STATE_FILE")"
    cur="$(harness_treehash "$HARNESS_ROOT")"
    if [[ -n "$prev" && "$prev" != "$cur" ]]; then
      echo "loop: tree drifted since stop (${prev} -> ${cur})" >&2
      git -C "$HARNESS_ROOT" status --short >&2 || true
      if [[ ! -t 0 ]]; then
        echo "loop: confirmOnTreeDrift requires a TTY, or set confirmOnTreeDrift: false" >&2
        exit 2
      fi
      read -r -p "Resume onto drifted tree? [y/N] " ans
      case "$ans" in
        y|Y) ;;
        *) echo "loop: abort"; exit 0 ;;
      esac
    fi
  fi
  # Preserve elapsed so far as base for this process.
  write_state "$(jq -c '
    .stoppedReason=""
    | .resumable=false
    | .elapsedBase=(.elapsedSeconds // 0)
  ' "$STATE_FILE")"
else
  mkdir -p "$HARNESS_ROOT/.harness"
  write_state "$(jq -nc \
    --arg goal "$goal" \
    --argjson maxTurns "$max_turns" \
    --arg started "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{
      goal:$goal,
      sessionId:"",
      turns:0,
      costUsd:0,
      elapsedSeconds:0,
      elapsedBase:0,
      treeHashAtStop:"",
      stopRetries:0,
      reviewCycles:0,
      lastReviewedHash:"",
      lastFailingStage:"",
      identicalFailureCount:0,
      maxTurns:$maxTurns,
      startedAt:$started,
      stoppedReason:"",
      resumable:false
    }')"
fi

while true; do
  check_budgets

  state="$(read_state)"
  turns="$(jq -r '.turns' <<<"$state")"
  echo "loop: turn $((turns + 1))/${max_turns} goal=${goal}" >&2

  if [[ "$gate" == "each-turn" && -t 0 ]]; then
    read -r -p "Continue turn $((turns + 1))? [y/N] " ans
    case "$ans" in
      y|Y) ;;
      *) stop_loop "gate" ;;
    esac
  fi

  invoke_agent_turn || true

  set +e
  "$HARNESS_ROOT/scripts/verify.sh" turn >/tmp/loop-verify.out 2>&1
  vec=$?
  set -e

  failing=""
  if [[ -f "$HARNESS_ROOT/.verify/report.json" ]]; then
    failing="$(jq -r '[.stages[]|select(.status=="fail")|.name]|first // empty' "$HARNESS_ROOT/.verify/report.json")"
  fi
  tree_now="$(harness_treehash "$HARNESS_ROOT")"
  elapsed=$(( $(date +%s) - ORIGIN_EPOCH + $(jq -r '.elapsedBase // 0' "$STATE_FILE") ))

  state="$(read_state)"
  prev_stage="$(jq -r '.lastFailingStage // empty' <<<"$state")"
  prev_hash="$(jq -r '.treeHashAtStop // empty' <<<"$state")"
  count="$(jq -r '.identicalFailureCount // 0' <<<"$state")"

  if [[ $vec -ne 0 ]]; then
    if [[ "$failing" == "$prev_stage" && "$tree_now" == "$prev_hash" && -n "$failing" ]]; then
      count=$((count + 1))
    else
      count=1
    fi
  else
    count=0
    failing=""
  fi

  state="$(jq -c \
    --argjson turns "$((turns + 1))" \
    --argjson elapsed "$elapsed" \
    --arg failing "$failing" \
    --arg hash "$tree_now" \
    --argjson c "$count" \
    '.turns=$turns
     | .elapsedSeconds=$elapsed
     | .lastFailingStage=$failing
     | .treeHashAtStop=$hash
     | .identicalFailureCount=$c' <<<"$state")"
  write_state "$state"

  if (( count >= stop_identical && count > 0 )); then
    stop_loop "stopOnIdenticalFailures"
  fi

  if [[ $vec -eq 0 && "${HARNESS_LOOP_DONE:-}" == "1" ]]; then
    stop_loop "complete"
  fi

  if [[ "$gate" == "on-commit" && -t 0 ]]; then
    read -r -p "Allow commit for this turn? [y/N] " ans
    case "$ans" in
      y|Y) echo "loop: commit allowed" >&2 ;;
      *) echo "loop: commit deferred" >&2 ;;
    esac
  fi

  # Re-check budgets after the turn so maxTurns stops without starting another.
  check_budgets
done
