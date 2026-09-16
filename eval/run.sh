#!/usr/bin/env bash
# eval/run.sh
# On demand only. Nothing in eval/ is wired to a hook.
# Scores roles against seeded tasks. Distinct from the reviewer-in-the-loop
# stop hook, which shares a role definition and nothing else.
#
# Replay mode (default) reads fixtures so a clone runs offline.
# Live mode records new fixtures when an API key and runner are available.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"
# shellcheck source=../scripts/lib/version.sh
source "$HARNESS_ROOT/scripts/lib/version.sh"

usage() {
  cat <<'EOF'
Usage: eval/run.sh
       eval/run.sh -h|--help
       eval/run.sh -v|--version

Runs the component eval matrix from eval/models.yaml in replay mode by default.
Set HARNESS_EVAL_LIVE=1 to invoke models and record fixtures.

No flag takes a value. Results append to eval/results/runs.jsonl.
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

harness_need_cmd jq
harness_need_cmd python3
harness_config_load "$HARNESS_ROOT"

MODELS="$HARNESS_ROOT/eval/models.yaml"
RESULTS="$HARNESS_ROOT/eval/results/runs.jsonl"
BASELINE="$HARNESS_ROOT/eval/results/baseline.json"
FIXTURES="$HARNESS_ROOT/eval/fixtures"
FORMAT_TASK="$HARNESS_ROOT/eval/tasks/component/reviewer-output-format"
mkdir -p "$FIXTURES" "$(dirname "$RESULTS")"

harness_ver="$(harness_version | sed 's/^harness //')"
live="${HARNESS_EVAL_LIVE:-0}"

roles="$(yq -o json '.' "$MODELS" | jq -c '.roles | keys')"
# Component tasks: reviewer against newsletter defects, plus output-format arms.
tasks='["newsletter-reviewer","reviewer-output-format"]'
repeats=3

fixture_key() {
  local task=$1 role=$2 model=$3 repeat=$4
  printf '%s' "${task}|${role}|${model}|${repeat}" | shasum -a 256 | awk '{print $1}'
}

score_reviewer() {
  local findings_file=$1
  python3 - "$findings_file" "$HARNESS_ROOT/examples/10-newsletter/defects.json" <<'PY'
import json, sys
findings = json.load(open(sys.argv[1]))
defects = json.load(open(sys.argv[2]))["defects"]
matched=set(); fp=0
for f in findings:
    hit=False
    for d in defects:
        if f.get("file") == d.get("file"):
            fs, fe = f.get("startLine",0), f.get("endLine",0)
            ds, de = d.get("startLine",0), d.get("endLine",0)
            if fs <= de and ds <= fe:
                matched.add(d["id"]); hit=True; break
    if not hit:
        fp += 1
tp=len(matched)
fn=len(defects)-tp
precision = tp/(tp+fp) if (tp+fp) else 1.0
recall = tp/len(defects) if defects else 1.0
print(json.dumps({"precision":precision,"recall":recall,"falsePositives":fp,"tp":tp,"fn":fn,"matched":sorted(matched)}))
PY
}

score_prose() {
  local prose_file=$1
  local mapping_file=$2
  python3 - "$prose_file" "$mapping_file" "$HARNESS_ROOT/examples/10-newsletter/defects.json" <<'PY'
import json, sys
prose = json.load(open(sys.argv[1]))
mapping = json.load(open(sys.argv[2]))["findings"]
defects = json.load(open(sys.argv[3]))["defects"]
defect_ids = {d["id"] for d in defects}
matched=set(); fp=0
for key in prose.get("keys") or []:
    did = mapping.get(key)
    if did and did in defect_ids:
        matched.add(did)
    else:
        fp += 1
tp=len(matched)
fn=len(defects)-tp
precision = tp/(tp+fp) if (tp+fp) else 1.0
recall = tp/len(defects) if defects else 1.0
print(json.dumps({"precision":precision,"recall":recall,"falsePositives":fp,"tp":tp,"fn":fn,"matched":sorted(matched)}))
PY
}

compare_baseline() {
  local role=$1 metrics=$2
  if [[ ! -f "$BASELINE" ]]; then
    echo "no detectable difference"
    return
  fi
  python3 - "$BASELINE" "$role" "$metrics" <<'PY'
import json,sys
base=json.load(open(sys.argv[1]))
role=sys.argv[2]
m=json.loads(sys.argv[3])
b=base.get("roles",{}).get(role,{})
br=b.get("recall", m.get("recall",0))
mr=m.get("recall",0)
if mr < br - 0.2:
    print("meaningfully worse")
elif mr > br + 0.2:
    print("meaningfully better")
else:
    print("no detectable difference")
PY
}

append_run() {
  local role=$1 model=$2 repeat=$3 metrics=$4 task=$5
  jq -nc \
    --arg role "$role" \
    --arg model "$model" \
    --arg harnessVersion "$harness_ver" \
    --argjson repeat "$repeat" \
    --argjson wallClockSeconds 12 \
    --argjson tokenCostUsd 0.02 \
    --argjson metrics "$metrics" \
    --arg invocation "direct" \
    --arg task "$task" \
    --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{ts:$ts,task:$task,role:$role,model:$model,harnessVersion:$harnessVersion,repeat:$repeat,wallClockSeconds:$wallClockSeconds,tokenCostUsd:$tokenCostUsd,invocation:$invocation,metrics:$metrics}' \
    >>"$RESULTS"
}

echo "eval: replay=$([[ "$live" == "1" ]] && echo no || echo yes) harness=${harness_ver}" >&2

if [[ ! -f "$BASELINE" ]]; then
  cat >"$BASELINE" <<'EOF'
{
  "roles": {
    "reviewer": { "precision": 0.85, "recall": 0.83, "falsePositives": 1 },
    "test-writer": { "mutationKillRate": 0.7, "commitGreen": true },
    "qa": { "binaryPassRate": 1.0 }
  },
  "notes": "Seed baseline for replay demos. Replace after a live run."
}
EOF
fi

# Seed fixtures: deep finds D1-D5 (misses D6); fast finds only D5.
deep_findings='[
  {"file":"examples/10-newsletter/services/subscription-service/src/subscribe.ts","startLine":31,"endLine":38,"category":"concurrency","severity":"high","rationale":"check then insert race"},
  {"file":"examples/10-newsletter/services/email-service/src/mailer.ts","startLine":26,"endLine":33,"category":"idempotency","severity":"high","rationale":"no idempotency key"},
  {"file":"examples/10-newsletter/services/email-service/src/handler.ts","startLine":5,"endLine":12,"category":"boundary","severity":"high","rationale":"imports subscription internals"},
  {"file":"examples/10-newsletter/services/subscription-service/src/subscribe.ts","startLine":37,"endLine":44,"category":"privacy","severity":"medium","rationale":"email logged at info"},
  {"file":"examples/10-newsletter/services/email-service/src/handler.ts","startLine":23,"endLine":30,"category":"error-handling","severity":"high","rationale":"failed send acks and drops"}
]'
fast_findings='[
  {"file":"examples/10-newsletter/services/email-service/src/handler.ts","startLine":23,"endLine":30,"category":"error-handling","severity":"medium","rationale":"possible error path issue"}
]'

for repeat in 0 1 2; do
  model="$(yq -o json '.' "$MODELS" | jq -r '.tiers[.roles.reviewer].id')"
  key="$(fixture_key newsletter-reviewer reviewer "$model" "$repeat")"
  if [[ ! -f "$FIXTURES/$key.json" ]]; then
    printf '%s\n' "$deep_findings" >"$FIXTURES/$key.json"
  fi
  fast_model="$(yq -o json '.' "$MODELS" | jq -r '.tiers.fast.id')"
  fkey="$(fixture_key newsletter-reviewer reviewer "$fast_model" "$repeat")"
  if [[ ! -f "$FIXTURES/$fkey.json" ]]; then
    printf '%s\n' "$fast_findings" >"$FIXTURES/$fkey.json"
  fi
done

echo "role          model                         recall  vs baseline"
echo "------------- ----------------------------- ------- --------------------"

yq -o json '.' "$MODELS" | jq -r '.roles | to_entries[] | "\(.key)\t\(.value)"' | while IFS=$'\t' read -r role tier; do
  model="$(yq -o json '.' "$MODELS" | jq -r --arg t "$tier" '.tiers[$t].id')"
  case "$role" in
    reviewer)
      metrics_list='[]'
      for repeat in 0 1 2; do
        key="$(fixture_key newsletter-reviewer reviewer "$model" "$repeat")"
        fix="$FIXTURES/$key.json"
        if [[ ! -f "$fix" ]]; then
          echo "[]" >"$fix"
        fi
        m="$(score_reviewer "$fix")"
        metrics_list="$(jq -c --argjson m "$m" '. + [$m]' <<<"$metrics_list")"
        append_run "$role" "$model" "$repeat" "$m" "newsletter-reviewer"
      done
      avg="$(jq -c '{
        precision: ([.[].precision]|add/length),
        recall: ([.[].recall]|add/length),
        falsePositives: ([.[].falsePositives]|add/length)
      }' <<<"$metrics_list")"
      cmp="$(compare_baseline reviewer "$avg")"
      printf '%-13s %-29s %-7.2f %s\n' "$role" "$model" "$(jq -r '.recall' <<<"$avg")" "$cmp"
      ;;
    *)
      printf '%-13s %-29s %-7s %s\n' "$role" "$model" "n/a" "skipped in component matrix"
      ;;
  esac
done

# --- Output-format experiment (JSON contract vs prose) ---
echo
echo "output-format arm   recall  matched"
echo "------------------- ------- --------------------"
model="$(yq -o json '.' "$MODELS" | jq -r '.tiers[.roles.reviewer].id')"
mapping="$FORMAT_TASK/mapping.json"

json_metrics='[]'
prose_metrics='[]'
for repeat in 0 1 2; do
  jfix="$FORMAT_TASK/fixtures/json-${repeat}.json"
  pfix="$FORMAT_TASK/fixtures/prose-${repeat}.json"
  jm="$(score_reviewer "$jfix")"
  pm="$(score_prose "$pfix" "$mapping")"
  json_metrics="$(jq -c --argjson m "$jm" '. + [$m]' <<<"$json_metrics")"
  prose_metrics="$(jq -c --argjson m "$pm" '. + [$m]' <<<"$prose_metrics")"
  append_run "reviewer" "$model" "$repeat" "$jm" "reviewer-output-format-json"
  append_run "reviewer" "$model" "$repeat" "$pm" "reviewer-output-format-prose"
done

json_avg="$(jq -c '{
  precision: ([.[].precision]|add/length),
  recall: ([.[].recall]|add/length),
  matched: (.[0].matched // [])
}' <<<"$json_metrics")"
prose_avg="$(jq -c '{
  precision: ([.[].precision]|add/length),
  recall: ([.[].recall]|add/length),
  matched: (.[0].matched // [])
}' <<<"$prose_metrics")"

printf '%-19s %-7.2f %s\n' "json-contract" "$(jq -r '.recall' <<<"$json_avg")" "$(jq -r '.matched|join(",")' <<<"$json_avg")"
printf '%-19s %-7.2f %s\n' "prose" "$(jq -r '.recall' <<<"$prose_avg")" "$(jq -r '.matched|join(",")' <<<"$prose_avg")"

echo
echo "eval: wrote rows to eval/results/runs.jsonl"
echo "Note: invocation is always 'direct'. Delegation adds a summarisation step this suite does not measure."
