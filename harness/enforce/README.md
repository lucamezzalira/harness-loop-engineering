# Enforce moments — logic lives in harness/lib/enforce/*.mjs

# Hooks call: HARNESS_IN_HOOK=1 ./verify.sh --hook

#

# pre_tool refuses writes under harness/state/, shell commands that write

# there (protect.stateWrites), and any command containing --allow-check-edit.

# The developer runs that flag from their own terminal. A person at that

# terminal can still record a local early warning. CI protected-change decides

# on the pull request. protect.shipCommands refuses, without an explicit

# instruction: gh pr edit --add-label, gh pr edit --remove-label,

# gh pr review --approve, gh pr merge, gh label, and any gh api path

# containing /labels, /reviews, or /merge. It also refuses gh pr review -a,

# --approve, -r, and --request-changes (a comment with -c stays allowed), a

# gh api graphql query that contains mutation, and curl, wget, http, node -e,

# or python -c when the call is a non-GET to api.github.com or names

# GITHUB_TOKEN, GH_TOKEN, or GH_ENTERPRISE_TOKEN. The list is pattern matching,

# so a new spelling can still get through. CI protected-change decides on the

# pull request. Keeping tokens out of the agent's environment is the real defence.

# The hash of the record must match

# harness/state/check-edits.log or check-integrity reports check-weakened.
