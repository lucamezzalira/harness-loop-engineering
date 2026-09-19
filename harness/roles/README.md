# Role assignment rule

**The weaker the deterministic check on a role's output, the stronger the model it needs.**
A model buys reliability once. A check buys it every time.

| Role | Produces | What checks it | Tier | Safe locally? |
|------|----------|----------------|------|---------------|
| planner | units, waves, acceptance criteria | nothing, and its errors propagate into everything | deep | no |
| reviewer | JSON findings | nothing. a defect it does not mention is one nobody hears about | deep | no |
| security | JSON findings with a CWE | semgrep overlaps partially. false negatives are silent | deep | no |
| product | whether the built feature matches the PRD | nothing. the only role reading intent against code | balanced | marginal |
| infra | IaC changes | `terraform validate`, `plan`, `tfsec` | balanced | yes |
| test-writer | tests | mutation score. objective | balanced | yes |
| qa | a reproduction | binary: fails on the broken commit, passes on the fixed one | fast | yes |

Roles never choose severity. They return a `category` from the closed list in `harness.yaml`; configuration maps category → P0–P3.

Frontmatter on each role file: `name`, `description`, `tier`, `tools`. Never a model.
