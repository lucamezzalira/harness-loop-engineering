# PRD: Close the self-authorisation hole, report against the PRD, keep the docs honest

## For Cursor: how to work on this PRD

Read the whole file first. Then work in order, because Part A closes a hole that every later part relies on.

1. For each requirement:
   - implement it;
   - run `./verify.sh --turn`;
   - run `/acceptance-checker` and `/integrity-checker`;
   - paste both verdicts into your reply.

   Move on only when both say PASS.

2. Stop after Part A, Part B and Part C, and wait for the developer each time.
3. Never commit, push or open a PR. Leave the work staged.
4. You aren't done until `specs/close-the-gaps/REPORT.md` exists and the acceptance checker has given it a PASS (see Part B). Don't tell the developer the work is finished before that.

### Constraints

- Don't change `harness/models.yaml`. The offline and hybrid-local profiles stay as they are.
- No scheduled or event-driven loop in the repo.
- The harness stays tool-agnostic across Cursor and Claude Code.
- No new production dependency without an ADR. Dev dependencies are fine.
- Put new acceptance entries in `specs/close-the-gaps/acceptance.json`, with IDs from A-49 onwards.
- A criterion that describes behaviour of the loop, a hook or the CLI needs a test that drives that entry point. A test that calls a helper on its own doesn't count.

## Context

A review of main at `f48476d` (PR #4) found that Part A of the follow-up PRD works, but has one hole. Parts B and C weren't delivered.

**The hole.** `./verify.sh --allow-check-edit` records the developer's approval in `harness/state/session.json`. `pre_tool` refuses agent writes to protected check paths unless that approval exists. But `pre_tool` allows:

- a Write or Edit tool call on `harness/state/session.json`;
- shell commands that write into `harness/state/` (`> harness/state/session.json`, `tee`, `node -e`, `cp`, `mv`);
- the agent running `./verify.sh --allow-check-edit` in its own shell. If the tool gives the agent a real terminal, the TTY check alone doesn't stop this.

So the agent can approve its own check edits. AGENTS.md says not to edit `harness/state/`, but nothing enforces it.

**Also found.** When no session exists, `--allow-check-edit` creates one hardcoded to profile `hybrid-local` and tool `cursor`, whatever the configuration says.

**Missing from the previous PRD.** The completion report reviewed against the PRD, the `report-against-prd` skill, the `report-present` and `doc-drift` sensors, and the acceptance-checker prompt changes. Part of the docs work happened (the README and the sensor guidance files), but nothing keeps the docs in sync.

## Part A: the agent can't approve itself

### F6 Protect the approval record

**Change.**

1. `pre_tool` refuses any write tool call (Write, Edit, MultiEdit, and the Cursor equivalents in the adapter) whose path is under `harness/state/`. The harness's own processes write state directly through Node, not through agent tools, so they're unaffected.
2. `pre_tool` refuses shell commands that write under `harness/state/`. Match at least:
   - redirection (`>`, `>>`) to a path under it;
   - `tee`, `cp`, `mv`, `rm`, `truncate`, `sed -i` and `node -e`/`python -c` with a path under it as an argument.

   Make the pattern list part of `protect` in `harness.yaml`, so it's itself a protected check path.

3. `pre_tool` refuses any shell command that contains `--allow-check-edit`. Only the developer runs it, from their own terminal.
4. **Defence in depth:**
   - `--allow-check-edit` refuses when `HARNESS_IN_HOOK=1`, or when any of the known agent environment markers are set. List them in one place, including whatever Cursor and Claude Code set for agent-run shell commands. Verify each marker against the tool's docs and cite the doc in a code comment.
   - If no reliable marker exists for a tool, say so in the code comment and in REPORT.md. Don't guess.
5. **Tamper evidence:** `--allow-check-edit` also writes a `sha256` of the record to `harness/state/check-edits.log`. `check-integrity` and `pre_tool` accept a record only if its hash matches the last log line.
   - This doesn't stop a determined attacker. It turns a silent self-approval into a detectable mismatch, which `check-integrity` reports as `check-weakened`.

**Acceptance.**

- A-49: Through `pre_tool`'s real entry point, a Write to `harness/state/session.json` is refused, with a reason naming `harness/state/`.
- A-50: Each of these shell commands is refused:
  - `echo x > harness/state/session.json`
  - `cat a | tee harness/state/session.json`
  - `cp /tmp/s.json harness/state/session.json`
  - `node -e "require('fs').writeFileSync('harness/state/session.json','{}')"`
  - `./verify.sh --allow-check-edit`
- A-51: A session record edited by hand, so its hash no longer matches the log, isn't accepted. `check-integrity` reports `check-weakened`.
- A-52: `--allow-check-edit` refuses when an agent environment marker is set. The test sets each marker in turn.
- A-53: The harness's own writes to `harness/state/` (session, report, retro) still work, proved by the existing loop and report tests passing.

### F7 Fallback session uses the real configuration

**Change.** When `--allow-check-edit` or `--backlog` triage creates a session because none exists, it takes `profile`, `tool` and `env` from `loadConfig`, never hardcoded values. Share one `newAdhocSession(root)` helper between the two.

**Acceptance.**

- A-54: With `tool: claude` and `profile: default` in a test config, and no session, `--allow-check-edit` writes a session with `tool: claude` and `profile: default`.
- A-55: `--backlog` triage uses the same helper. A test asserts both code paths produce identical fallback sessions.

## Part B: report against the PRD before sharing

Course principle: done is a claim, and claims get checked by someone other than the writer. The previous two merges each reported every criterion green while something couldn't work as designed. One had a field read but never written. The other had a protected record any agent could write.

### R1 Completion report, reviewed before it's shared

**Process rule for this PRD and every future one.** Before telling the developer the work is done, Cursor produces `specs/<slug>/REPORT.md` with four sections:

1. **Criteria:** one row per acceptance ID, with:
   - the test that covers it;
   - whether that test drives the real entry point or a helper on its own;
   - the code path the criterion depends on (file and line);
   - the result of the last green run.
2. **Wiring proof:** for every new flag, field or record the code reads, the place in the code that writes it. Anything read but never written is a FAIL.
3. **Bypass check:** for every new protection, how an agent could get around it (another tool, the shell, writing the state it reads, setting the flag it trusts), and the test that blocks each route. A route with no test is a FAIL, or a known gap if the developer accepts it.
4. **Known gaps and rerun commands:** what couldn't be verified, what was assumed, and the exact commands that reproduce the evidence.

`/acceptance-checker` reviews `REPORT.md` against `PRD.md`, `acceptance.json` and the diff, and appends its verdict line, `acceptance-checker: PASS` or `FAIL` with reasons. Only a PASS report is shared. A FAIL goes back to the implementer, never to the developer.

### R2 Make it repeatable in the harness

**Change.**

1. Add a new skill, `harness/skills/report-against-prd/SKILL.md`, describing the four sections, the review step and the verdict line.
2. Add three duties to the `acceptance-checker` role prompt:
   - every field the diff reads has a writer;
   - flag a criterion whose only test calls a helper on its own when the criterion describes end-to-end behaviour;
   - for every new protection, the bypass section lists the shell route, the state-file route and the flag route, each with a test.
3. Add a new deterministic sensor, `report-present`: commit tier, blocking, local and CI. It fails when a `specs/<slug>/` whose `acceptance.json` has every entry passing has no `REPORT.md` ending in `acceptance-checker: PASS`.
4. Write the missing reports, so the new sensor doesn't fail on day one:
   - `specs/align-harness-with-course/REPORT.md`
   - `specs/followup-fixes/REPORT.md`
   - `specs/close-the-gaps/REPORT.md`

   The two older reports must state honestly what the reviews found: the false-positive metric was never written before PR #4, and the approval record could be self-written before this PRD.

**Acceptance.**

- A-56: The `report-against-prd` skill exists and names the four sections and the verdict line.
- A-57: The acceptance-checker prompt contains the three duties. Fake-provider fixtures, each expecting FAIL:
  - a field read but never written;
  - an end-to-end criterion tested only through a helper;
  - a protection with no shell-route test.
- A-58: `report-present` fails on a fixture spec with every criterion passing and no `REPORT.md`, fails when the report ends in FAIL, and passes when it ends in PASS.
- A-59: The three `REPORT.md` files exist, each ending in `acceptance-checker: PASS`, and `report-present` is green on main.

## Part C: keep the docs honest across the repo

### D1 Finish the content update

Docs in scope:

- `README.md`, `AGENTS.md`, `CLAUDE.md`, `HANDOFF.md`;
- `docs/**` and the ADR index;
- `harness/roles/README.md` and every role file;
- every `SKILL.md`;
- every `harness/sensors/guidance/*.md`;
- `harness/render/*/HOOKS.md`;
- `harness/enforce/README.md`;
- `harness/rules/README.md`;
- `harness.local.yaml.example`;
- the comments in `harness.yaml`.

Rules for every doc:

- Every command, flag, path and config key it mentions must exist.
- Describe the state protection from F6, and say plainly what it can't stop: an attacker with the developer's own terminal.
- Describe the report-against-prd rule and the `report-present` sensor.
- The retired host name appears only in accepted ADRs and in ADR 0006.
- `AGENTS.md` gains one boundary line: the agent never runs `--allow-check-edit` and never writes `harness/state/`. It stays within `limits.agentsMdLines`.
- `docs/loop-failure-modes.md` gains rows for:
  - an agent self-approving a check edit through the state file;
  - a metric that's never written;
  - a test that passes against a helper but not the real entry point.

### D2 The doc-drift sensor

Add a deterministic sensor, `doc-drift`: turn tier, blocking, local and CI. It fails when:

- a flag accepted by `harness/lib/cli.mjs` is missing from the README commands table;
- a sensor in `sensors.yaml` has no `guidance/<name>.md`, or no mention in the README;
- an enabled role in `harness.yaml` has no row in `harness/roles/README.md`;
- a skill folder isn't listed in the README;
- a top-level key in `harness.yaml` isn't described in the README configuration section;
- a relative link in any tracked markdown file points to a path that doesn't exist.

**Acceptance.**

- A-60: `doc-drift` fails on a fixture for each of the six cases above, and passes on main after Part C.
- A-61: a search of the docs for the retired host name returns only accepted ADRs and ADR 0006.
- A-62: `AGENTS.md` has the new boundary line and is within `limits.agentsMdLines`. `context-budget` is green.
- A-63: The README has a "What changed" section covering PRs #2 to #4 and this PRD, with links to the three specs and their reports.

## Out of scope

- Model changes, scheduled loops, the retired host, deployment.
- Installing the tools that the skipped sensors need (knip, jscpd, dependency-cruiser and others). They stay visible as skipped.

## Definition of done

- Every acceptance ID from A-49 to A-63 has a named test that ran green.
- `npm test` is green.
- `./verify.sh` (commit tier) is green, apart from SAST if semgrep.dev is unreachable locally. Say so in REPORT.md.
- The three `REPORT.md` files exist, each with an acceptance-checker PASS.
- The work is staged and not committed, waiting for the developer's ship instruction.
