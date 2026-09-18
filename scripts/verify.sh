#!/usr/bin/env bash
# scripts/verify.sh
# Run verification stages up to a tier: edit, turn, or commit (default).
# Stage inventory lives in .verify/stages.yaml (sole source of truth).
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

Stage list, order, tier, and advisory flags come from stages.yaml next to the
stage scripts (or the path in VERIFY_STAGES). Filenames are implementations
only; do not infer policy from NN- prefixes.

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
harness_need_cmd yq

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

# Resolve stages.yaml. VERIFY_STAGES may be the file itself or a directory
# containing stages.yaml (legacy env from scenario.sh).
resolve_stages_manifest() {
  local candidate
  if [[ -n "${VERIFY_STAGES:-}" ]]; then
    if [[ -f "${VERIFY_STAGES}" ]]; then
      printf '%s\n' "$(cd "$(dirname "${VERIFY_STAGES}")" && pwd)/$(basename "${VERIFY_STAGES}")"
      return
    fi
    if [[ -d "${VERIFY_STAGES}" && -f "${VERIFY_STAGES}/stages.yaml" ]]; then
      printf '%s\n' "$(cd "${VERIFY_STAGES}" && pwd)/stages.yaml"
      return
    fi
    echo "VERIFY_STAGES set but no stages.yaml at ${VERIFY_STAGES}" >&2
    exit 2
  fi
  for candidate in \
    "$VERIFY_ROOT/.verify/stages/stages.yaml" \
    "$HARNESS_ROOT/.verify/stages.yaml"
  do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
      return
    fi
  done
  # Also accept stages.yaml beside a stages dir under VERIFY_ROOT/.verify/
  if [[ -f "$VERIFY_ROOT/.verify/stages.yaml" ]]; then
    printf '%s\n' "$(cd "$VERIFY_ROOT/.verify" && pwd)/stages.yaml"
    return
  fi
  echo "no stages.yaml found (set VERIFY_STAGES or add .verify/stages.yaml)" >&2
  exit 2
}

STAGES_MANIFEST="$(resolve_stages_manifest)"
STAGES_DIR="$(cd "$(dirname "$STAGES_MANIFEST")" && pwd)"
export VERIFY_STAGES="$STAGES_DIR"
export VERIFY_STAGES_MANIFEST="$STAGES_MANIFEST"

tier_rank() {
  case "$1" in
    edit) echo 1 ;;
    turn) echo 2 ;;
    commit) echo 3 ;;
    *) echo 99 ;;
  esac
}

fail_fast="$(harness_config_get verify.failFast)"
budget_ms="$(harness_config_get verify.editTierBudgetMs)"
harness_ver="$(harness_version | sed 's/^harness //')"
tree_hash="$(harness_treehash "$VERIFY_ROOT")"
started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
start_ms="$(python3 -c 'import time; print(int(time.time()*1000))')"

stages_tmp=$(mktemp)
stage_list=$(mktemp)
trap 'rm -f "$stages_tmp" "$stage_list"' EXIT
: >"$stages_tmp"

overall="pass"
overall_exit=0
want_rank="$(tier_rank "$tier")"

truncate_output() {
  python3 -c 'import sys; t=sys.stdin.read(); print(t[:8000], end="")'
}

# Load manifest into stage_list as TSV: id\ttier\trun\tadvisory\tsummary
if ! yq -o json '.' "$STAGES_MANIFEST" >/dev/null 2>&1; then
  echo "stages.yaml is malformed: ${STAGES_MANIFEST}" >&2
  exit 2
fi

stage_count="$(yq -o json '.' "$STAGES_MANIFEST" | jq '.stages // [] | length')"
if [[ "$stage_count" -eq 0 ]]; then
  echo "stages.yaml has no stages: ${STAGES_MANIFEST}" >&2
  exit 2
fi

yq -o json '.' "$STAGES_MANIFEST" | jq -r '
  .stages[] |
  [
    .id,
    .tier,
    .run,
    (if .advisory == true then "1" else "0" end),
    (.summary // "")
  ] | @tsv
' >"$stage_list"

# Orphan check: every physical executable in STAGES_DIR (not a symlink) must be
# referenced by some run: entry. Symlinks to shared scripts are ignored here;
# overlays list them explicitly via relative paths.
python3 - "$STAGES_DIR" "$STAGES_MANIFEST" <<'PY' || exit 2
import json, os, subprocess, sys
stages_dir, manifest = sys.argv[1], sys.argv[2]
raw = subprocess.check_output(["yq", "-o", "json", ".", manifest], text=True)
data = json.loads(raw)
runs = set()
for s in data.get("stages") or []:
    run = s.get("run") or ""
    # basename match for local scripts; also full resolved path
    runs.add(os.path.basename(run))
    abs_run = run if os.path.isabs(run) else os.path.normpath(os.path.join(stages_dir, run))
    runs.add(os.path.basename(abs_run))

orphans = []
for name in os.listdir(stages_dir):
    if name in ("stages.yaml",) or name.startswith("."):
        continue
    path = os.path.join(stages_dir, name)
    if os.path.islink(path):
        continue
    if not os.path.isfile(path):
        continue
    if not os.access(path, os.X_OK):
        continue
    if name not in runs:
        orphans.append(name)
if orphans:
    print(
        "stages.yaml orphan executables (not listed in run:): "
        + ", ".join(sorted(orphans)),
        file=sys.stderr,
    )
    sys.exit(1)
PY

run_stage() {
  local id=$1
  local stage_tier=$2
  local run_rel=$3
  local advisory=$4
  local path

  if [[ "$run_rel" = /* ]]; then
    path="$run_rel"
  else
    path="$STAGES_DIR/$run_rel"
  fi
  path="$(cd "$(dirname "$path")" && pwd)/$(basename "$path")"

  if [[ ! -f "$path" ]]; then
    echo "stage ${id}: missing run path ${run_rel}" >&2
    overall="fail"
    overall_exit=2
    return 2
  fi
  if [[ ! -x "$path" ]]; then
    echo "stage ${id} is not executable (${path})" >&2
    overall="fail"
    overall_exit=2
    return 2
  fi

  local stage_start stage_end duration out_file ec status
  out_file=$(mktemp)
  stage_start="$(python3 -c 'import time; print(int(time.time()*1000))')"
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
    if [[ "$advisory" == "1" ]]; then
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
    --arg name "$id" \
    --arg status "$status" \
    --argjson exitCode "$ec" \
    --argjson durationMs "$duration" \
    --arg output "$output" \
    '{name:$name,status:$status,exitCode:$exitCode,durationMs:$durationMs,output:$output}' \
    >>"$stages_tmp"

  printf '  %-24s %s (%dms, exit %d)\n' "$id" "$status" "$duration" "$ec" >&2
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

echo "verify: tier=${tier} root=${VERIFY_ROOT} manifest=${STAGES_MANIFEST}" >&2

while IFS=$'\t' read -r sid stier srun sadvisory ssummary; do
  [[ -z "$sid" ]] && continue
  case "$stier" in
    edit|turn|commit) ;;
    *)
      echo "stage ${sid}: invalid tier '${stier}'" >&2
      overall="fail"
      overall_exit=2
      break
      ;;
  esac
  if (( $(tier_rank "$stier") > want_rank )); then
    continue
  fi
  set +e
  run_stage "$sid" "$stier" "$srun" "$sadvisory"
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
