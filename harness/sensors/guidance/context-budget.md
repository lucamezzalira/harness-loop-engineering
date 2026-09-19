# context-budget

## Why this exists
Codex stops loading context files once the chain reaches 32 KiB, silently. Instruction following also degrades as rule count grows. AGENTS.md must stay under 200 lines; skill bodies under 60.

## What to do
1. Move durable decisions into ADRs (`docs/adr/`).
2. Move workflows into skills (loaded only when they match).
3. Keep AGENTS.md to commands, testing, structure, style deltas, git, and boundaries.

## Thresholds
On install, a legacy over-budget file is baselined. Growth above the baseline fails. You may raise `baseline.agentsMdLines` only while actively shrinking the file, and must record why.
