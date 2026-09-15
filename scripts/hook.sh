#!/usr/bin/env bash
# scripts/hook.sh
# Normalise a tool-specific hook payload and dispatch portable handlers.
# HARNESS_TOOL is set by the generated adapter. Do not sniff the payload:
# dialects converge and sniffing will break silently.
#
# Dialect notes:
# - Claude Code accepts an exit code or richer JSON on stdout. For PreToolUse it
#   distinguishes permissionDecision deny from a hard stop.
# - Cursor expects JSON with a permission field, treats exit 2 as deny, and fails
#   open on other non-zero exits unless failClosed is set.
# - Codex uses a comparable exit code and JSON protocol, and skips a non-managed
#   command hook until its exact definition has been reviewed and trusted, with
#   trust tied to the hook's hash so any edit re-arms the review.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"
# shellcheck source=lib/treehash.sh
source "$HARNESS_ROOT/scripts/lib/treehash.sh"
# shellcheck source=lib/trace.sh
source "$HARNESS_ROOT/scripts/lib/trace.sh"

usage() {
  cat <<'EOF'
Usage: scripts/hook.sh
       scripts/hook.sh -h|--help
       scripts/hook.sh -v|--version

Reads a hook payload from stdin. HARNESS_TOOL selects the dialect
(claude|cursor|codex). Generated adapters set it; do not sniff the payload.

Only four events may carry a blocking gate: session_start, pre_tool,
post_tool, stop. Handlers for anything else belong in .verify/hooks/optional/.

The config file is optional. Every invocation is a fresh process that reads
the config at startup, so an edit takes effect on the next event.
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

TOOL="${HARNESS_TOOL:-}"
if [[ -z "$TOOL" ]]; then
  echo "hook: HARNESS_TOOL is unset. Generated adapters must set it." >&2
  # fail closed for Cursor when wired; emit deny-shaped JSON
  printf '%s\n' '{"permission":"deny","user_message":"HARNESS_TOOL unset"}'
  exit 2
fi

payload="{}"
if [[ ! -t 0 ]]; then
  # Strip a leading UTF-8 BOM if present (Windows Cursor quirk).
  payload="$(python3 -c 'import sys; d=sys.stdin.buffer.read();
print(d[3:].decode() if d.startswith(b"\xef\xbb\xbf") else d.decode())')"
  if [[ -z "$payload" ]]; then
    payload="{}"
  fi
fi

# Normalise event name to the portable four.
normalise_event() {
  # Prefer HARNESS_EVENT from the generated adapter. Payload event names vary
  # by tool and are a secondary signal only.
  if [[ -n "${HARNESS_EVENT:-}" ]]; then
    echo "$HARNESS_EVENT"
    return 0
  fi
  local raw
  raw="$(jq -r '
    .hook_event_name // .hookEventName // .event // .name // empty
  ' <<<"$payload")"
  case "$raw" in
    SessionStart|sessionStart|session_start) echo session_start ;;
    PreToolUse|preToolUse|pre_tool) echo pre_tool ;;
    PostToolUse|postToolUse|post_tool) echo post_tool ;;
    Stop|stop) echo stop ;;
    *) echo "$raw" ;;
  esac
}

EVENT="$(normalise_event)"
case "$EVENT" in
  session_start|pre_tool|post_tool|stop) ;;
  *)
    # Non-portable: only run if under optional/, else reject registration path.
    if [[ -d "$HARNESS_ROOT/.verify/hooks/optional" ]]; then
      EVENT="optional:$EVENT"
    else
      emit_allow "ignored non-portable event"
      exit 0
    fi
    ;;
esac

emit_allow() {
  local reason=${1:-}
  case "$TOOL" in
    cursor)
      jq -nc --arg r "$reason" '{permission:"allow",agent_message:$r}'
      ;;
    claude)
      jq -nc --arg r "$reason" '{continue:true,suppressOutput:false,systemMessage:$r}'
      ;;
    codex)
      jq -nc --arg r "$reason" '{permission:"allow",message:$r}'
      ;;
    *)
      jq -nc --arg r "$reason" '{permission:"allow",message:$r}'
      ;;
  esac
}

emit_deny() {
  local reason=$1
  case "$TOOL" in
    cursor)
      jq -nc --arg r "$reason" '{permission:"deny",user_message:$r,agent_message:$r}'
      # Cursor: exit 2 also denies
      return 2
      ;;
    claude)
      # PreToolUse: permissionDecision deny. Stop: block with reason.
      if [[ "$EVENT" == "pre_tool" ]]; then
        jq -nc --arg r "$reason" '{
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: $r
          }
        }'
      else
        jq -nc --arg r "$reason" '{
          decision: "block",
          reason: $r
        }'
      fi
      return 2
      ;;
    codex)
      jq -nc --arg r "$reason" '{permission:"deny",message:$r}'
      return 2
      ;;
    *)
      jq -nc --arg r "$reason" '{permission:"deny",message:$r}'
      return 2
      ;;
  esac
}

HANDLERS_DIR="$HARNESS_ROOT/.verify/hooks"
if [[ "$EVENT" == optional:* ]]; then
  HANDLERS_DIR="$HARNESS_ROOT/.verify/hooks/optional"
  EVENT_DIR="$HANDLERS_DIR"
else
  EVENT_DIR="$HANDLERS_DIR/$EVENT"
fi

export VERIFY_ROOT="${VERIFY_ROOT:-$HARNESS_ROOT}"
export HARNESS_HOOK_PAYLOAD="$payload"
export HARNESS_HOOK_EVENT="${EVENT#optional:}"
export HARNESS_HOOK_TOOL="$TOOL"

# Collect executable handlers in lexical order.
handler_list=$(mktemp)
trap 'rm -f "$handler_list"' EXIT
if [[ -d "$EVENT_DIR" ]]; then
  find "$EVENT_DIR" -maxdepth 1 -type f ! -name '.*' ! -name '*.md' \
    | while IFS= read -r p; do basename "$p"; done \
    | sort \
    | while IFS= read -r base; do
        if [[ -x "$EVENT_DIR/$base" ]]; then
          printf '%s\n' "$EVENT_DIR/$base"
        fi
      done >"$handler_list"
fi

deny_reason=""
while IFS= read -r handler; do
  [[ -z "$handler" ]] && continue
  out=$(mktemp)
  ec=0
  "$handler" <<<"$payload" >"$out" 2>"$out.err" || ec=$?
  if [[ -s "$out.err" ]]; then
    cat "$out.err" >&2
  fi
  if [[ $ec -eq 2 ]]; then
    deny_reason="$(cat "$out")"
    rm -f "$out" "$out.err"
    break
  fi
  if [[ $ec -ne 0 ]]; then
    echo "hook handler $(basename "$handler") exited $ec" >&2
    # non-2 failures: continue unless we want fail-closed; Cursor failClosed
    # covers crash of hook.sh itself. Handler soft-fail is advisory.
  fi
  rm -f "$out" "$out.err"
done <"$handler_list"

if [[ -n "$deny_reason" ]]; then
  set +e
  emit_deny "$deny_reason"
  exit 2
fi

emit_allow ""
exit 0
