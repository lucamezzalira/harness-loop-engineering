#!/usr/bin/env bash
# scripts/verify.sh
# Run verification stages up to a tier: edit, turn, or commit (default).
# Config: verify.failFast, verify.editTierBudgetMs. The config file is optional.
# Nothing in this repo parses stdout. Hooks, CI, loop.sh and eval read report.json.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"
# shellcheck source=lib/treehash.sh
source "$HARNESS_ROOT/scripts/lib/treehash.sh"

usage() {
  cat <<'EOF'
Usage: scripts/verify.sh [edit|turn|commit]
       scripts/verify.sh -h|--help
       scripts/verify.sh -v|--version

Runs every stage up to and including the named tier. Default: commit.

Exit codes
  0  pass
  1  the code under test is wrong
  2  the harness is wrong (missing tool, bad or absent config)

Config (verify.*)
  failFast           default true. Stop at the first failing stage. Set false in
                     CI so a human sees every failure. Agents given nine failures
                     pick the wrong one to start on.
  maxStopRetries     default 2. How many times the stop hook may block on a red
                     turn tier before allowing the stop.
  editTierBudgetMs   default 1000. A stage exceeding this is recorded as a
                     budget breach.

The whole config file is optional. Delete it and verify runs on defaults.
EOF
}

harness_parse_flags -- "$@"
if [[ "${HARNESS_CLI_HELP}" -eq 1 ]]; then
  usage
  exit 0
fi
if [[ "${HARNESS_CLI_VERSION}" -eq 1 ]]; then
  harness_print_version_and_exit
fi

harness_config_load "$HARNESS_ROOT"
harness_need_cmd jq
harness_need_cmd python3

tier="commit"
if [[ ${#HARNESS_CLI_POSITIONAL[@]} -gt 0 ]]; then
  tier="${HARNESS_CLI_POSITIONAL[0]}"
fi
case "$tier" in
  edit|turn|commit) ;;
  *)
    echo "unrecognised tier: ${tier}" >&2
    echo "valid: edit turn commit" >&2
    exit 2
    ;;
esac

VERIFY_ROOT="${VERIFY_ROOT:-$PWD}"
VERIFY_ROOT="$(cd "$VERIFY_ROOT" && pwd)"
export VERIFY_ROOT
export VERIFY_TIER="$tier"
export VERIFY_CHANGED_FILES="${VERIFY_CHANGED_FILES:-}"

resolve_stages_dir() {
  if [[ -n "${VERIFY_STAGES:-}" && -d "${VERIFY_STAGES}" ]]; then
    printf '%s\n' "$(cd "$VERIFY_STAGES" && pwd)"
    return
  fi
  if [[ -d "$VERIFY_ROOT/.verify/stages" ]]; then
    printf '%s\n' "$VERIFY_ROOT/.verify/stages"
    return
  fi
  if [[ -d "$HARNESS_ROOT/.verify/stages" ]]; then
    printf '%s\n' "$HARNESS_ROOT/.verify/stages"
    return
  fi
  echo "no stages directory found" >&2
  exit 2
}

VERIFY_STAGES="$(resolve_stages_dir)"
export VERIFY_STAGES

max_num=99
case "$tier" in
  edit) max_num=29 ;;
  turn) max_num=59 ;;
  commit) max_num=99 ;;
esac

fail_fast="$(harness_config_get verify.failFast)"
budget_ms="$(harness_config_get verify.editTierBudgetMs)"
harness_ver="$(harness_version | sed 's/^harness //')"
tree_hash="$(harness_treehash "$VERIFY_ROOT")"
started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
start_ms="$(python3 -c 'import time; print(int(time.time()*1000))')"

stages_tmp=$(mktemp)
trap 'rm -f "$stages_tmp"' EXIT
: >"$stages_tmp"

overall="pass"
overall_exit=0

truncate_output() {
  python3 -c 'import sys; t=sys.stdin.read(); print(t[:8000], end="")'
}

run_stage() {
  local path=$1
  local name
  name="$(basename "$path")"
  local num="${name%%-*}"
  # skip non-numeric
  case "$num" in
    ''|*[!0-9]*) return 0 ;;
  esac
  if (( 10#$num > max_num )); then
    return 0
  fi
  if [[ ! -x "$path" ]]; then
    echo "stage ${name} is not executable" >&2
    overall="fail"
    overall_exit=2
    return 2
  fi

  local stage_start stage_end duration out_file ec status advisory
  advisory=0
  case "$name" in
    *.advisory) advisory=1 ;;
  esac

  out_file=$(mktemp)
  stage_start="$(python3 -c 'import time; print(int(time.time()*1000))')"
  # Do not toggle set -e here. set is process-global, so re-enabling it inside
  # this function would make a non-zero return abort the caller before the
  # report is written.
  ec=0
  (
    cd "$VERIFY_ROOT"
    "$path"
  ) >"$out_file" 2>&1 || ec=$?
  stage_end="$(python3 -c 'import time; print(int(time.time()*1000))')"
  duration=$((stage_end - stage_start))

  local output
  output="$(truncate_output <"$out_file")"
  rm -f "$out_file"

  status="pass"
  if [[ $ec -eq 2 ]]; then
    status="fail"
    overall="fail"
    overall_exit=2
  elif [[ $ec -ne 0 ]]; then
    if [[ $advisory -eq 1 ]]; then
      status="warn"
    else
      status="fail"
      if [[ $overall_exit -ne 2 ]]; then
        overall="fail"
        overall_exit=1
      fi
    fi
  fi

  if [[ "$tier" == "edit" && $duration -gt $budget_ms && $ec -eq 0 ]]; then
    status="fail"
    output="budget breach: ${duration}ms > ${budget_ms}ms"$'\n'"$output"
    if [[ $overall_exit -ne 2 ]]; then
      overall="fail"
      overall_exit=1
    fi
  fi

  jq -nc \
    --arg name "$name" \
    --arg status "$status" \
    --argjson exitCode "$ec" \
    --argjson durationMs "$duration" \
    --arg output "$output" \
    '{name:$name,status:$status,exitCode:$exitCode,durationMs:$durationMs,output:$output}' \
    >>"$stages_tmp"

  printf '  %-24s %s (%dms, exit %d)\n' "$name" "$status" "$duration" "$ec" >&2
  if [[ -n "$output" && "$status" != "pass" ]]; then
    printf '%s\n' "$output" | sed 's/^/    /' >&2
  fi

  if [[ $ec -eq 2 ]]; then
    return 2
  fi
  if [[ "$fail_fast" == "true" && "$status" == "fail" ]]; then
    return 1
  fi
  return 0
}

echo "verify: tier=${tier} root=${VERIFY_ROOT} stages=${VERIFY_STAGES}" >&2

# Numeric order by filename. -L follows symlinks so example stage dirs can
# link to the generic set (find -type f otherwise skips symlink entries).
stage_list=$(mktemp)
trap 'rm -f "$stages_tmp" "$stage_list"' EXIT
find -L "$VERIFY_STAGES" -maxdepth 1 -type f \( -perm -100 -o -perm -10 -o -perm -1 \) \
  | while IFS= read -r p; do basename "$p"; done \
  | sort \
  | while IFS= read -r base; do printf '%s\n' "$VERIFY_STAGES/$base"; done \
  >"$stage_list" || true

# find -perm portability: also include all non-hidden files and chmod +x expectation.
if [[ ! -s "$stage_list" ]]; then
  find -L "$VERIFY_STAGES" -maxdepth 1 -type f ! -name '.*' ! -name '*.md' \
    | while IFS= read -r p; do basename "$p"; done \
    | sort \
    | while IFS= read -r base; do printf '%s\n' "$VERIFY_STAGES/$base"; done \
    >"$stage_list"
fi

while IFS= read -r stage_path; do
  [[ -z "$stage_path" ]] && continue
  [[ -f "$stage_path" ]] || continue
  set +e
  run_stage "$stage_path"
  rc=$?
  set -e
  if [[ $rc -eq 2 ]]; then
    break
  fi
  if [[ $rc -eq 1 && "$fail_fast" == "true" ]]; then
    break
  fi
done <"$stage_list"

end_ms="$(python3 -c 'import time; print(int(time.time()*1000))')"
duration_ms=$((end_ms - start_ms))

stages_json="$(jq -s '.' "$stages_tmp")"
report="$(jq -nc \
  --arg tier "$tier" \
  --arg startedAt "$started_at" \
  --argjson durationMs "$duration_ms" \
  --arg status "$overall" \
  --arg root "$VERIFY_ROOT" \
  --arg treeHash "$tree_hash" \
  --arg harnessVersion "$harness_ver" \
  --argjson stages "$stages_json" \
  '{
    tier:$tier,
    startedAt:$startedAt,
    durationMs:$durationMs,
    status:$status,
    root:$root,
    treeHash:$treeHash,
    harnessVersion:$harnessVersion,
    stages:$stages
  }')"

mkdir -p "$VERIFY_ROOT/.verify"
printf '%s\n' "$report" >"$VERIFY_ROOT/.verify/report.json"

echo "verify: status=${overall} durationMs=${duration_ms} treeHash=${tree_hash}" >&2
exit "$overall_exit"
