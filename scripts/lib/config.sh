# scripts/lib/config.sh
# Load, merge, validate, and explain harness.config.yaml.
# Precedence: harness.config.local.yaml > harness.config.yaml > built-in defaults.
# The whole file is optional. A missing config is only an error for loop.sh.

if [[ -z "${HARNESS_ROOT:-}" ]]; then
  HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

# shellcheck source=version.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/version.sh"

HARNESS_DEFAULTS_JSON='{
  "trace": {
    "enabled": false,
    "level": "events",
    "retainSessions": 10
  },
  "review": {
    "enabled": true,
    "maxCycles": 2,
    "requireVerifyGreen": true
  },
  "verify": {
    "failFast": true,
    "maxStopRetries": 2,
    "editTierBudgetMs": 1000
  },
  "loop": {
    "maxSeconds": 1800,
    "maxCostUsd": 5.00,
    "gate": "on-commit",
    "stopOnIdenticalFailures": 2,
    "confirmOnTreeDrift": true,
    "enumerateFirst": true
  },
  "limits": {
    "agentsMdTokens": 800,
    "agentFileTokens": 1200,
    "skillBodyLines": 60
  }
}'

# Dotted keys that loop.sh requires from file or local. They have no default.
HARNESS_LOOP_REQUIRED=(loop.goal loop.maxTurns)

HARNESS_CONFIG_JSON="{}"
HARNESS_CONFIG_SOURCES_JSON="{}"
HARNESS_CONFIG_FILE_KEYS_JSON="{}"
HARNESS_CONFIG_LOCAL_KEYS_JSON="{}"

_harness_yaml_to_json() {
  local file=$1
  if [[ ! -f "$file" ]]; then
    echo "{}"
    return 0
  fi
  if [[ ! -s "$file" ]]; then
    echo "{}"
    return 0
  fi
  harness_need_cmd yq
  harness_need_cmd jq
  local out
  if ! out="$(yq -o json '.' "$file" 2>/dev/null)"; then
    echo "harness.config.yaml is malformed and could not be parsed." >&2
    echo "Found:    $(basename "$file")" >&2
    echo "The harness reads this file on every hook invocation. Fix the YAML or delete the file to fall back to defaults." >&2
    exit 2
  fi
  jq 'if . == null then {} else . end' <<<"$out"
}

_harness_flatten() {
  # Do not use paths(scalars). In jq, false is a scalar that is also falsy, so
  # select(scalars) drops every boolean false (trace.enabled, among others).
  jq -c '
    def flatten:
      . as $in
      | reduce paths(type != "object" and type != "array") as $p ({};
          . + { ($p | map(tostring) | join(".")): ($in | getpath($p)) });
    flatten
  '
}

_harness_setting_because() {
  case "$1" in
    trace.enabled) echo "it is the master switch for reasoning and event logs, off by default because level full captures source code and prompt text" ;;
    trace.level) echo "it chooses whether the trace stores lifecycle events or also payloads and file contents" ;;
    trace.retainSessions) echo "it caps how many sessions sit under .harness/trace before oldest-first deletion" ;;
    review.enabled) echo "it decides whether the reviewer role runs on real work at end of turn" ;;
    review.maxCycles) echo "it caps how many times the reviewer may send the agent back within one turn" ;;
    review.requireVerifyGreen) echo "it skips review when the turn tier is red, so you do not spend money rediscovering what verify already said" ;;
    verify.failFast) echo "it stops at the first failing stage. Agents given nine failures pick the wrong one to start on" ;;
    verify.maxStopRetries) echo "it caps how many times the stop hook may block on a red turn tier before escalating to the human" ;;
    verify.editTierBudgetMs) echo "edit-tier slowness is what quietly stops agents verifying, and a breach must be visible" ;;
    loop.goal) echo "the loop has to know what it is building" ;;
    loop.maxTurns) echo "a loop with no turn budget will not stop on its own" ;;
    loop.maxSeconds) echo "it is a wall-clock brake already engaged that you may release" ;;
    loop.maxCostUsd) echo "it is a spend brake already engaged that you may release" ;;
    loop.gate) echo "it chooses where the human is asked: never, each-turn, or on-commit" ;;
    loop.stopOnIdenticalFailures) echo "it is how the loop concludes the agent is stuck rather than working" ;;
    loop.confirmOnTreeDrift) echo "silent resumption onto a moved tree is the worst failure this system can produce" ;;
    loop.enumerateFirst) echo "a fresh loop needs features.json before it implements, or later sessions invent done" ;;
    limits.agentsMdTokens) echo "always-on context that exceeds this budget steers less and costs more" ;;
    limits.agentFileTokens) echo "a role prompt above this size usually wants a skill, not more prose" ;;
    limits.skillBodyLines) echo "skills above roughly sixty body lines travel badly and should be split" ;;
    *) echo "the harness cannot interpret a value of the wrong type" ;;
  esac
}

_harness_config_type_error() {
  local key=$1 expected=$2 found=$3
  local because
  because="$(_harness_setting_because "$key")"
  cat >&2 <<EOF
${key%%.*}: harness.config.yaml has a value of the wrong type.

  Missing:  (expected ${expected})
  Found:    ${key} = ${found}

${key} is required because ${because}. Expected ${expected}.

Run scripts/loop.sh -h for every setting.
EOF
  exit 2
}

_harness_validate_value() {
  local key=$1
  local json_val=$2
  local typ actual
  typ="$(jq -r 'type' <<<"$json_val")"
  actual="$(jq -c '.' <<<"$json_val")"

  case "$key" in
    trace.enabled|review.enabled|review.requireVerifyGreen|verify.failFast|loop.confirmOnTreeDrift|loop.enumerateFirst)
      [[ "$typ" == "boolean" ]] || _harness_config_type_error "$key" "boolean" "$actual"
      ;;
    trace.retainSessions|review.maxCycles|verify.maxStopRetries|verify.editTierBudgetMs|loop.maxTurns|loop.maxSeconds|loop.stopOnIdenticalFailures|limits.agentsMdTokens|limits.agentFileTokens|limits.skillBodyLines)
      if [[ "$typ" != "number" ]] || [[ "$(jq 'floor == .' <<<"$json_val")" != "true" ]]; then
        _harness_config_type_error "$key" "integer" "$actual"
      fi
      ;;
    loop.maxCostUsd)
      [[ "$typ" == "number" ]] || _harness_config_type_error "$key" "number" "$actual"
      ;;
    trace.level)
      [[ "$typ" == "string" ]] || _harness_config_type_error "$key" "string (events|full)" "$actual"
      if [[ "$(jq -r '.' <<<"$json_val")" != "events" && "$(jq -r '.' <<<"$json_val")" != "full" ]]; then
        _harness_config_type_error "$key" "string (events|full)" "$actual"
      fi
      ;;
    loop.gate)
      [[ "$typ" == "string" ]] || _harness_config_type_error "$key" "string (never|each-turn|on-commit)" "$actual"
      case "$(jq -r '.' <<<"$json_val")" in
        never|each-turn|on-commit) ;;
        *) _harness_config_type_error "$key" "string (never|each-turn|on-commit)" "$actual" ;;
      esac
      ;;
    loop.goal)
      [[ "$typ" == "string" ]] || _harness_config_type_error "$key" "string" "$actual"
      if [[ -z "$(jq -r '.' <<<"$json_val")" ]]; then
        _harness_config_type_error "$key" "non-empty string" "$actual"
      fi
      ;;
  esac
}

# Populate HARNESS_CONFIG_JSON (nested) and HARNESS_CONFIG_SOURCES_JSON (dotted key -> layer).
harness_config_load() {
  local root="${1:-$HARNESS_ROOT}"
  HARNESS_ROOT="$root"
  harness_need_cmd jq

  local file_json local_json
  file_json="$(_harness_yaml_to_json "$root/harness.config.yaml")"
  local_json="$(_harness_yaml_to_json "$root/harness.config.local.yaml")"

  local defaults_flat file_flat local_flat
  defaults_flat="$(jq -c '.' <<<"$HARNESS_DEFAULTS_JSON" | _harness_flatten)"
  file_flat="$(jq -c '.' <<<"$file_json" | _harness_flatten)"
  local_flat="$(jq -c '.' <<<"$local_json" | _harness_flatten)"

  HARNESS_CONFIG_FILE_KEYS_JSON="$file_flat"
  HARNESS_CONFIG_LOCAL_KEYS_JSON="$local_flat"

  local merged_flat sources_flat
  merged_flat="$(jq -c -n --argjson d "$defaults_flat" --argjson f "$file_flat" --argjson l "$local_flat" '$d * $f * $l')"
  sources_flat="$(jq -c -n --argjson d "$defaults_flat" --argjson f "$file_flat" --argjson l "$local_flat" '
    def keys_of: keys;
    ([$d, $f, $l] | map(keys) | add | unique) as $keys
    | reduce $keys[] as $k ({};
        if ($l | has($k)) then . + {($k): "local"}
        elif ($f | has($k)) then . + {($k): "file"}
        else . + {($k): "default"}
        end
      )
  ')"

  local key val
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    val="$(jq -c --arg k "$key" '.[$k]' <<<"$merged_flat")"
    _harness_validate_value "$key" "$val"
  done < <(jq -r 'keys[]' <<<"$merged_flat")

  HARNESS_CONFIG_JSON="$(jq -c -n --argjson d "$HARNESS_DEFAULTS_JSON" --argjson f "$file_json" --argjson l "$local_json" '$d * $f * $l')"
  HARNESS_CONFIG_SOURCES_JSON="$sources_flat"
}

harness_config_get() {
  local key=$1
  jq -r --arg k "$key" '
    ($k | split(".")) as $p
    | getpath($p)
    | if . == null then empty
      elif type == "string" then .
      elif type == "boolean" or type == "number" then tostring
      else tojson
      end
  ' <<<"$HARNESS_CONFIG_JSON"
}

harness_config_get_json() {
  local key=$1
  jq -c --arg k "$key" '($k | split(".")) as $p | getpath($p)' <<<"$HARNESS_CONFIG_JSON"
}

harness_config_source() {
  local key=$1
  jq -r --arg k "$key" '.[$k] // "default"' <<<"$HARNESS_CONFIG_SOURCES_JSON"
}

harness_config_print_resolved() {
  local key src val
  echo "resolved config (local > file > default):"
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    src="$(harness_config_source "$key")"
    val="$(harness_config_get "$key")"
    printf '  %-32s %-8s %s\n' "$key" "[$src]" "$val"
  done < <(jq -r 'keys[]' <<<"$HARNESS_CONFIG_SOURCES_JSON" | sort)
}

_harness_loop_present_keys() {
  jq -r '
    [
      (["loop.goal","loop.maxTurns","loop.maxSeconds","loop.maxCostUsd","loop.gate","loop.stopOnIdenticalFailures","loop.confirmOnTreeDrift","loop.enumerateFirst"][]) as $k
      | select(has($k))
      | $k
    ] | join(", ")
  ' <<<"$(jq -c -n --argjson f "$HARNESS_CONFIG_FILE_KEYS_JSON" --argjson l "$HARNESS_CONFIG_LOCAL_KEYS_JSON" '$f * $l')"
}

harness_config_require_loop() {
  local missing=()
  local key
  for key in "${HARNESS_LOOP_REQUIRED[@]}"; do
    local src
    src="$(harness_config_source "$key")"
    if [[ "$src" != "file" && "$src" != "local" ]]; then
      missing+=("$key")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    return 0
  fi

  local found
  found="$(_harness_loop_present_keys)"
  if [[ -z "$found" ]]; then
    found="(none)"
  fi

  local first="${missing[0]}"
  local missing_list="" key_item
  for key_item in "${missing[@]}"; do
    if [[ -n "$missing_list" ]]; then
      missing_list="${missing_list}, ${key_item}"
    else
      missing_list="$key_item"
    fi
  done

  local because snippet extra
  case "$first" in
    loop.maxTurns)
      because="a loop with no turn budget will not stop on its own. Set it to the number of agent turns you are willing to spend."
      snippet=$'  loop:\n    maxTurns: 20'
      extra="A turn is one agent response cycle, counted at the stop event. Verification retries and reviewer cycles happen inside a turn and do not count toward it, so one turn can contain several agent responses. Start at 20 and adjust once you have seen what your goal costs."
      ;;
    loop.goal)
      because="the loop has to know what it is building. Point it at a PRD file, or put a one-line objective in quotes."
      snippet=$'  loop:\n    goal: docs/prd/example.md'
      extra="The agent already maintains a todo list when given a PRD. The harness owns whether it may continue, not what to do next."
      ;;
  esac

  cat >&2 <<EOF
loop: harness.config.yaml is missing a required setting.

  Missing:  ${missing_list}
  Found:    ${found}

${first} is required because ${because}

${snippet}

${extra}

Run scripts/loop.sh -h for every setting.
EOF
  exit 2
}
