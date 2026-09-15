# scripts/lib/trace.sh
# Append-only session traces under .harness/trace/<session-id>/events.ndjson.
# Driven by the trace config block. Never buffered to session end.

if [[ -n "${HARNESS_TRACE_LOADED:-}" ]]; then
  return 0 2>/dev/null || true
fi
HARNESS_TRACE_LOADED=1

if [[ -z "${HARNESS_ROOT:-}" ]]; then
  HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

# shellcheck source=config.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/config.sh"
# shellcheck source=version.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/version.sh"

HARNESS_TRACE_SESSION=""
HARNESS_TRACE_DIR=""

_harness_trace_redact() {
  # Redact common key patterns and anything that looks like .env content.
  python3 -c '
import json, re, sys
text = sys.stdin.read()
try:
    obj = json.loads(text)
except Exception:
    sys.stdout.write(text)
    sys.exit(0)

key_re = re.compile(r"(api[_-]?key|token|secret|password|authorization|credential)", re.I)
env_re = re.compile(r"(?i)(sk-[a-z0-9]{10,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,})")

def scrub(v):
    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            if key_re.search(str(k)):
                out[k] = "[redacted]"
            else:
                out[k] = scrub(val)
        return out
    if isinstance(v, list):
        return [scrub(x) for x in v]
    if isinstance(v, str):
        return env_re.sub("[redacted]", v)
    return v

sys.stdout.write(json.dumps(scrub(obj), separators=(",", ":")))
'
}

harness_trace_session_id() {
  local payload=${1:-\{\}}
  local sid
  sid="$(jq -r '
    .session_id // .sessionId // .conversation_id // .conversationId // empty
  ' <<<"$payload" 2>/dev/null || true)"
  if [[ -z "$sid" || "$sid" == "null" ]]; then
    sid="$(date -u +"%Y%m%dT%H%M%SZ")-$$"
  fi
  printf '%s\n' "$sid"
}

harness_trace_rotate() {
  local root="${1:-$HARNESS_ROOT}"
  local keep
  keep="$(harness_config_get trace.retainSessions)"
  keep="${keep:-10}"
  local base="$root/.harness/trace"
  [[ -d "$base" ]] || return 0
  local count
  count="$(find "$base" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  if (( count <= keep )); then
    return 0
  fi
  local excess=$((count - keep))
  # shellcheck disable=SC2012
  ls -1dt "$base"/*/ 2>/dev/null | tail -n "$excess" | while IFS= read -r dir; do
    rm -rf "$dir"
  done
}

harness_trace_init() {
  local root="${1:-$HARNESS_ROOT}"
  local payload=${2:-\{\}}
  harness_config_load "$root"
  if [[ "$(harness_config_get trace.enabled)" != "true" ]]; then
    HARNESS_TRACE_SESSION=""
    HARNESS_TRACE_DIR=""
    return 0
  fi
  HARNESS_TRACE_SESSION="$(harness_trace_session_id "$payload")"
  HARNESS_TRACE_DIR="$root/.harness/trace/$HARNESS_TRACE_SESSION"
  mkdir -p "$HARNESS_TRACE_DIR"
  harness_trace_rotate "$root"
  : >>"$HARNESS_TRACE_DIR/events.ndjson"
}

harness_trace_snapshot_env() {
  local root="${1:-$HARNESS_ROOT}"
  harness_config_load "$root"
  local stages bindings freshness version
  stages="$(ls -1 "$root/.verify/stages" 2>/dev/null | tr '\n' ',' | sed 's/,$//')"
  bindings="$(yq -o json '.' "$root/eval/models.yaml" | jq -c '
    .roles as $r | .tiers as $t
    | $r | to_entries | map({role:.key, tier:.value, model:($t[.value].id)})
  ')"
  freshness="unknown"
  if [[ -f "$root/.claude/settings.json" ]]; then
    freshness="adapters present"
  fi
  version="$(harness_version | sed 's/^harness //')"
  # Assemble in Python so large config blobs never pass through shell --argjson.
  HARNESS_SNAP_STAGES="$stages" \
  HARNESS_SNAP_BINDINGS="$bindings" \
  HARNESS_SNAP_FRESHNESS="$freshness" \
  HARNESS_SNAP_VERSION="$version" \
  HARNESS_SNAP_CONFIG="${HARNESS_CONFIG_JSON:-\{\}}" \
  HARNESS_SNAP_SOURCES="${HARNESS_CONFIG_SOURCES_JSON:-\{\}}" \
  python3 - <<'PY'
import json, os
print(json.dumps({
  "stages": os.environ.get("HARNESS_SNAP_STAGES", ""),
  "bindings": json.loads(os.environ.get("HARNESS_SNAP_BINDINGS", "[]")),
  "adapterFreshness": os.environ.get("HARNESS_SNAP_FRESHNESS", ""),
  "harnessVersion": os.environ.get("HARNESS_SNAP_VERSION", ""),
  "resolved": {
    "config": json.loads(os.environ.get("HARNESS_SNAP_CONFIG", "{}")),
    "sources": json.loads(os.environ.get("HARNESS_SNAP_SOURCES", "{}")),
  },
}))
PY
}

harness_trace_append() {
  local event=$1
  local payload=${2:-\{\}}
  if [[ "$(harness_config_get trace.enabled)" != "true" ]]; then
    return 0
  fi
  if [[ -z "${HARNESS_TRACE_DIR:-}" ]]; then
    harness_trace_init "${VERIFY_ROOT:-$HARNESS_ROOT}" "$payload"
  fi
  [[ -n "${HARNESS_TRACE_DIR:-}" ]] || return 0

  if ! jq -e . >/dev/null 2>&1 <<<"$payload"; then
    payload="{}"
  fi

  local level size_cap
  level="$(harness_config_get trace.level)"
  size_cap=5242880

  if [[ -f "$HARNESS_TRACE_DIR/events.ndjson" ]]; then
    local sz
    sz=$(wc -c <"$HARNESS_TRACE_DIR/events.ndjson" | tr -d ' ')
    if (( sz > size_cap )); then
      echo "trace: size cap reached for ${HARNESS_TRACE_SESSION}" >&2
      return 0
    fi
  fi

  local payload_file record
  payload_file=$(mktemp)
  printf '%s' "$payload" >"$payload_file"
  record="$(jq -nc \
    --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg event "$event" \
    --arg session "$HARNESS_TRACE_SESSION" \
    --arg level "$level" \
    --slurpfile payload "$payload_file" \
    '{ts:$ts,event:$event,session:$session,level:$level,payload:$payload[0]}')"
  rm -f "$payload_file"
  record="$(printf '%s' "$record" | _harness_trace_redact)"
  printf '%s\n' "$record" >>"$HARNESS_TRACE_DIR/events.ndjson"
}
