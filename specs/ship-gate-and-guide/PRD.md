# PRD: Close three ship-gate spellings and flesh out two guide steps

`pre_tool` let three spellings through without a ship instruction: the short review flags, a GraphQL mutation, and a non-GET call to the GitHub API. Two steps in the guide were only a sentence each.

## Acceptance

- A-95: Without a ship instruction, `pre_tool` refuses `gh pr review` with `-a` or `--request-changes`, a `gh api graphql` query that contains `mutation`, `curl -X PUT` to `api.github.com`, a `curl` that names `GITHUB_TOKEN`, and `wget --method=POST` to `api.github.com`. The reason names the ship gate.
- A-96: A review comment (`-c`), a GraphQL `query`, a token-free GET `curl`, and `gh pr view` stay allowed.
- A-97: The enforce README, guide step 10, and `docs/loop-failure-modes.md` each name the pattern-matching limit and the token rule. `doc-drift` stays green.
- A-98: Guide step 5 contains a `specs/<slug>/` tree, a `PRD.md` excerpt, an `acceptance.json` excerpt that parses, and `./verify.sh --plan`.
- A-99: Guide step 13 contains the interview, a failing then passing `node --test` run, and an `ESC-` entry whose JSON parses.
- A-100: The guide command-runner test still passes with the new commands.

## Out of scope

Other HTTP clients, a script written to a file and then run, and a token the agent can already read from its environment. The bypass section records those.
