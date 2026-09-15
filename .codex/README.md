# Codex adapter placeholder

#

# This adapter is not built. A visibly unfinished third adapter is stronger

# evidence for the tool-agnosticism claim than two polished ones, because it

# shows the seam.

#

# What it would contain:

# - Generated agent prompts under `.codex/agents/`, rendered from `agents/` and

# `eval/models.yaml` the same way Claude and Cursor adapters are.

# - Hook wiring for the portable four events (`SessionStart`, `PreToolUse`,

# `PostToolUse`, `Stop`) pointing at `scripts/hook.sh` with `HARNESS_TOOL=codex`.

#

# Trust model gotcha (from the hook contract): Codex skips a non-managed command

# hook until its exact definition has been reviewed and trusted, with trust tied

# to the hook's hash so any edit re-arms the review. The adapter must document

# that re-trust step, or operators will think hooks are broken after every

# `adapters/render.sh` run.
