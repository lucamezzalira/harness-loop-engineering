# Agent identity

GitHub cannot tell an agent from the developer when the agent can use the developer's token. Session start names the credentials it can see. It does not block the session.

The warning lists environment names, a `gh auth status` login, and a readable `.env` in the repository root. It does not print values. It always says it cannot see credentials in files it does not know about, keychains, or SSO caches.

## Copilot cloud agent

The risks page is the source for the limits below. https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations

- **One branch** is the limit on where the agent can push. On an existing pull request that is the pull request branch. Otherwise it is a new `copilot/` branch. https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations
- **Cannot approve or merge** means the agent cannot mark its pull request ready, and cannot approve or merge it. https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations
- **Requester cannot approve** means the user who asked the agent to open the pull request cannot approve it. https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations
- **Workflows wait for a human** means Actions workflows do not run until someone with write access approves them. https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations

Hosted review in this repository is advisory. An approval from the review panel, or from Copilot code review, does not count toward the ruleset. Leave Copilot approvals off, as `docs/platform-gates.md` records.
