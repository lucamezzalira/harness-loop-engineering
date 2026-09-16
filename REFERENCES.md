# References

Sources behind the claims in this repo. A talk that presents one study as settled
invites a correction from the audience, so counterweights sit next to the
headline results.

## Context files

- Gloaguen et al., _Evaluating AGENTS.md: Are Repository-Level Context Files
  Helpful for Coding Agents?_, arXiv:2602.11988, SRI Lab ETH Zurich. Context
  files do not generally improve task success while increasing inference cost by
  over 20% on average, across models, agents, and both LLM-generated and
  developer-committed files. CTXBENCH is 138 instances from 12 repositories.

- Lulla et al. 2026. Curated `AGENTS.md` files improve efficiency on focused
  pull requests: 28.6% less runtime and 16.6% fewer output tokens. Cite beside
  Gloaguen, not instead of it.

- Mechanism that reconciles them: agents follow the file's instructions
  literally even when counterproductive. A tool named in the file was used 160
  times more often than without it. A context file does not make the agent
  smarter. It makes the agent do more of whatever the file mentions.

## Minimal vs structured harnesses

- mini-swe-agent: around 100 lines of Python, bash only, no tool-calling
  interface, above 74% on SWE-bench Verified. The unstructured baseline behind
  scenario `00-minimal`.

- 2026 harness comparison: mini-swe-agent with Claude Opus 4.7 at 68.3% against
  Hermes Agent at 64.6% and Claude Code at 62.2% on the same model. Minimalist
  architectures can outperform feature-heavy ones, and the minimal harness
  gained more from a stronger model than the structured one did.

- Anthropic architecture guidance: multi-agent systems at roughly 10 to 15 times
  the token cost of single agents.

## Long-running agents

- Anthropic, _Effective harnesses for long-running agents_. Source for
  `features.json` (definition of done that survives context loss) and for
  `PROGRESS.md`, `scripts/init.sh`, and the session opening routine.

- Anthropic, _Effective context engineering for AI agents_. Altitude argument:
  keep always-on context short, load procedures on demand.

## Prompting and ownership

- OpenAI, GPT-5-Codex prompting guide. Less is more: start minimal, cut tools
  back, avoid over-prompting. The reason the reviewer JSON contract is treated
  as a cost to measure (see `eval/tasks/component/reviewer-output-format/`)
  rather than free structure.

- OpenAI, September 2026, building on the open Codex harness. The application
  owns the interface, business context, tools, and approval gates. The harness
  owns the agent loop and sandboxed execution. Convergent with this repo's
  split: adapters are thin, enforcement lives in portable hooks and verify
  stages.

## What this repo claims instead

The claim that survives the benchmarks above is narrower than "a harness makes
the agent better." A harness manufactures a definition of done where the
repository does not have one, and makes output acceptable to a team without a
human reading every line. Benchmarks grade against a hidden test suite that is
guaranteed correct and complete. That oracle is free and perfect there, and
absent in most working repositories. That gap is the subject.
