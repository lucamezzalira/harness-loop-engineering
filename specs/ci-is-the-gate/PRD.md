# PRD: CI is the gate for protected changes, plus a step-by-step guide

## For Cursor: how to work on this PRD

Read the whole file first, then work in order.

1. For each requirement:
   - implement it;
   - run `./verify.sh --turn`;
   - run `/acceptance-checker` and `/integrity-checker`;
   - paste both verdicts into your reply.

   Move on only when both say PASS.

2. Stop after Part A and after Part B, and wait for the developer each time.
3. Never commit, push or open a PR. Leave the work staged.
4. You're done only when `specs/ci-is-the-gate/REPORT.md` exists, follows the `report-against-prd` skill (criteria, wiring proof, bypass check, known gaps), and ends in `acceptance-checker: PASS`. Then `report-present` and `doc-drift` are green.

### Constraints

- Tool-agnostic: nothing in this PRD may depend on Cursor or Claude Code. The deciding check runs in CI.
- Don't change `harness/models.yaml`.
- No scheduled or event-driven agent loop.
- No new production dependency without an ADR. Use Node's built-in `fetch` for the GitHub API, not an SDK.
- New acceptance entries go in `specs/ci-is-the-gate/acceptance.json`, from A-64 onwards.
- A criterion about CI behaviour needs a test that runs the check's real entry point with a fixture repo and a mocked GitHub API. A helper tested on its own doesn't count.
- Protected check paths need the developer's `--allow-check-edit` before you edit them. Ask for it; never work around the refusal.

## Context

Main at `b7e9128` protects check paths locally through IDE hooks. That protection is only as strong as each tool's hooks. In Cursor, the agent's Write tool isn't intercepted at all, so the agent can write its own approval.

Separately, `check-integrity` compares the working tree against `HEAD`. In CI the checkout is clean, so the diff is empty and the check always passes. A PR that edits `harness.yaml`, a sensor or a lint config passes CI with no approval. There's also no committed `CODEOWNERS` file.

**Decision.** CI on the pull request becomes the gate for protected changes. Local hooks stay as early warnings. The developer chose not to include GitHub branch protection in this PRD. Because of that, a red check will warn but won't stop a merge, and the docs must say so plainly.

## Part A: the CI gate

### C1 A CI-only sensor for protected changes

Add a new sensor, `protected-change`: commit tier, blocking, `where: [ci]`, with its script and its guidance file. Its job is to decide whether a pull request's protected changes were approved by a person who owns them.

**Which changes count.** The changed files are `git diff --name-only <merge-base>...HEAD`. The merge base comes from the pull-request event's base SHA. A file counts as protected when it matches `protect.checkPaths` or `review.humanRequired.paths` in `harness.yaml`. Added lines are also matched against `review.humanRequired.patterns`.

**Which events it handles.**

- `pull_request` and `pull_request_review` events are evaluated as below.
- On a `push` to the default branch, the sensor looks up the merged PR for the commit (`GET /repos/{owner}/{repo}/commits/{sha}/pulls`) and applies the same rule to it. A direct push with protected changes and no PR fails.
- On any other `push` (a feature branch), it reports `skipped (no pull request)` and exits 0.

**What counts as approval.** Protected changes pass only when, for every protected file, one of these holds after the PR's latest commit:

1. A user listed as an owner of that file in `CODEOWNERS` has submitted an `APPROVED` review whose `commit_id` equals the head SHA. The PR author doesn't count, and GitHub doesn't allow authors to approve their own PRs anyway.
2. **Solo-maintainer route.** The PR author is the only owner of that file. In that case a code owner must add the label `protected-change-approved`. The sensor checks the issue timeline (`GET /repos/{owner}/{repo}/issues/{n}/timeline`) for a `labeled` event whose actor is in `CODEOWNERS`.

   **A push makes the label stale.** Don't compare against the commit's committer date: the author sets that date, so it can be backdated. Instead, a separate workflow job runs on `pull_request: synchronize` and removes the label. That job needs `issues: write`, and nothing else gets write permission. The label can then only be present if a code owner added it after the latest push.

**Output.**

- On failure, it lists each protected file, the rule it matched, its owners, and what's missing.
- On success, it names the approver for each file, and the route used (review or label).
- The result goes into `report.json` under `protectedChange`.

**Workflow changes.**

- Add `pull_request_review: types: [submitted, dismissed]`, and `pull_request: types: [opened, synchronize, reopened, labeled, unlabeled]`, so the check re-runs when approval changes.
- Set `permissions: contents: read, pull-requests: read, issues: read` for the verify job. Only the label-removal job gets `issues: write`.
- Pass `GITHUB_TOKEN` to the sensor through the environment, never through a flag.

**Local behaviour.** The sensor is `where: [ci]`. Locally `--status` lists it as CI-only, and it never runs.

**Acceptance.**

- A-64: Fixture repo with a mocked API: a PR changing `harness.yaml` with no reviews fails, and the output names `harness.yaml`, the matched rule and its owner.
- A-65: The same PR, with an `APPROVED` review on the head SHA from a code owner who isn't the author, passes.
- A-66: An `APPROVED` review on an older commit doesn't count. The PR fails until there's a review on the head SHA.
- A-67: Solo route: the author is the only owner and added the label, so it passes. A `synchronize` event fixture runs the label-removal job, and the check then fails until the label is added again. A backdated committer date has no effect, and a test proves it.
- A-68: A label added by a user who isn't in `CODEOWNERS` doesn't count.
- A-69: Added lines matching `review.humanRequired.patterns` (for example `DROP TABLE`) need approval even when the file isn't on a protected path.
- A-70: A PR with no protected changes passes without calling the reviews or timeline APIs. The test asserts zero calls.
- A-71: A `push` to the default branch with protected changes and no associated PR fails. A `push` to a feature branch reports skipped and exits 0.
- A-72: A missing `GITHUB_TOKEN`, or a GitHub API error, exits 2 (harness wrong), never 0.

### C2 Committed CODEOWNERS

**Change.**

1. Commit `.github/CODEOWNERS`. It covers every glob in `protect.checkPaths` and `review.humanRequired.paths`, plus `.github/CODEOWNERS` itself, all owned by `@lucamezzalira`.
2. Add `.github/CODEOWNERS` to `protect.checkPaths`, so the local hooks also warn on it.
3. Extend `--install` so a consuming repo gets the same file. It interviews the developer for owners, never overwrites an existing file, and prints the globs that end up without an owner.
4. **New deterministic sensor `codeowners-coverage`:** turn tier, blocking, local and CI. It fails when a glob in `protect.checkPaths` or `review.humanRequired.paths` has no matching `CODEOWNERS` line.

**Acceptance.**

- A-73: `.github/CODEOWNERS` exists and covers every protected glob, plus itself.
- A-74: `codeowners-coverage` fails on a fixture where one protected glob has no owner, and passes on main.
- A-75: `--install` in a fixture repo with an existing `CODEOWNERS` leaves it byte-identical, and reports any uncovered globs.

### C3 Local protection becomes the early warning

**Change.**

- `--allow-check-edit`, `pre_tool` and `check-integrity` keep working locally as they do now.
- Their messages and guidance say they are early warnings, and that CI's `protected-change` decides.
- `check-integrity` adds one line to its output whenever it passes because of a local approval: `local approval only; CI protected-change decides on the pull request`.
- Remove any wording in code comments or docs that calls the local record proof of approval.

**Acceptance.**

- A-76: A `check-integrity` pass that relies on a local record prints the early-warning line, and a test asserts it.
- A-77: `grep` over `harness/` and `docs/` finds no wording that calls the local approval authoritative. The test lists the forbidden phrases it checks.

## Part B: documentation

### D1 Bring every doc up to date

**Scope:**

- `README.md`, `AGENTS.md`, `CLAUDE.md`, `HANDOFF.md`;
- `docs/**` and the ADR index;
- every role, skill and guidance file;
- `harness/render/*/HOOKS.md`, `harness/enforce/README.md`, `harness/rules/README.md`;
- `harness.local.yaml.example`;
- the comments in `harness.yaml`;
- the PR template, if one exists.

**Content to cover:**

- **The new trust model, in one short section:**
  - CI on the PR decides;
  - local hooks are early warnings, and they're only as strong as each tool's hooks (state Cursor's Write gap plainly);
  - the solo-maintainer label route;
  - without branch protection, a red `protected-change` doesn't block a merge. Add one sentence on how to switch it on in GitHub, marked optional.
- **The security limit:** if the agent can use the developer's GitHub token, the server can't tell agent from developer. Keep tokens out of the agent's environment. The ship gate already refuses `git push` and `gh pr create`. Say that `gh pr edit` and label commands also count as ship actions, and add them to the ship gate's refused patterns in `pre_tool` (with a test).
- **An ADR,** `docs/adr/0007-ci-decides-protected-changes.md`, recording this decision and superseding nothing.

**Acceptance.**

- A-78: ADR 0007 exists, is in the index, and passes `adr-frontmatter`.
- A-79: The README trust-model section names `protected-change`, the label route and the branch-protection caveat.
- A-80: `pre_tool` refuses `gh pr edit --add-label protected-change-approved` and `gh api .../labels` without an explicit ship instruction, with a test for each.

### D2 Step-by-step guide

Add `docs/guide.md`, linked from the top of the README. It is written for someone who has never seen the repo, works the same for Cursor and Claude Code, and shows exact commands with what each one prints when it succeeds. The steps:

1. **Prerequisites:** Node version, npm, git, and the optional tools for the skipped sensors (gitleaks, semgrep and the rest).
2. **Install into a repo:** `./verify.sh --install`, what the interview asks, and which files it writes.
3. **Pick your tool and render:** `harness.local.yaml`, `./verify.sh --render`, `--render --check`, and how to confirm the hooks are live (`--status` shows `enforcement: on`).
4. **First check run:** `--edit`, `--turn` and the commit tier; reading `report.json` and `review.md`; exit codes 0, 1 and 2.
5. **Write a PRD:** the `write-a-prd` skill, and the layout of `specs/<slug>/` with `acceptance.json`.
6. **Plan and loop:** `--plan`, reading the plan, `--loop`, budgets, the `STOP` file, and `--resume`.
7. **Review:** the review panel, the checker subagents, severities, `needs-human` units, and the trust ladder.
8. **Backlog triage:** `--backlog` on a terminal, and what keep, discard and promote do to the metrics.
9. **Changing a check:** `--allow-check-edit` locally, then the PR, then code-owner approval or the solo label.
10. **Shipping:** the ship gate, giving the explicit instruction, opening the PR yourself.
11. **After the run:** `--report`, the wave retro in `harness/retro/`, and `HANDOFF.md`.
12. **Finishing a spec:** the `report-against-prd` skill, `REPORT.md`, and `report-present`.
13. **When a bug escapes:** the `fix-an-escape` skill.
14. **Troubleshooting:** a table of the commonest failures and what to do about each, built from `docs/loop-failure-modes.md`. It must include exit 2 from a missing tool, SAST without network, `check-integrity` refusing your own edit, and `protected-change` red on a PR.

**Doc-drift coverage.** Extend `doc-drift` so it also fails when:

- a `./verify.sh` command in a code block in `docs/guide.md` uses a flag that the CLI doesn't accept;
- the guide doesn't mention a flag the CLI accepts;
- the README doesn't link to the guide.

**Acceptance.**

- A-81: `docs/guide.md` exists with the 14 steps as headings, in this order, and the README links to it in its first screen (within the first 40 lines).
- A-82: `doc-drift` fails on fixtures for an unknown flag in the guide, a CLI flag missing from the guide, and a missing README link. It passes on main.
- A-83: Every command block in the guide that starts with `./verify.sh` runs in CI without exiting 2, except `--loop`, `--install` and `--allow-check-edit`, which only check `--help`. A test loops over the extracted commands.

## Out of scope

- Turning on GitHub branch protection (developer's decision). The docs mention it as optional.
- Wiring Cursor's `preToolUse` hook, model changes, scheduled loops, the retired host, deployment.
- CI providers other than GitHub Actions. Mention this in ADR 0007 as a known limit.

## Definition of done

- Every acceptance ID from A-64 to A-83 has a named test that ran green.
- `npm test` is green.
- `./verify.sh` (commit tier) is green, apart from SAST if semgrep.dev is unreachable locally. Say so in REPORT.md.
- `doc-drift`, `report-present` and `codeowners-coverage` are green.
- `specs/ci-is-the-gate/REPORT.md` ends in `acceptance-checker: PASS`. Its bypass section covers at least:
  - a review on an old commit;
  - a label added before a push;
  - a label added by a non-owner;
  - a direct push to main;
  - an agent using the developer's token.
- The work is staged and not committed, waiting for the developer's ship instruction.
