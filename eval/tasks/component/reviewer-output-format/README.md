# Reviewer output format (component)

Same defect set (newsletter D1 to D6), same model tier, two arms:

| Arm     | Prompt                                                             | Scoring                        |
| ------- | ------------------------------------------------------------------ | ------------------------------ |
| `json`  | Strict JSON findings array (current `agents/reviewer.md` contract) | Set overlap vs `defects.json`  |
| `prose` | Free-form findings, no JSON schema                                 | Hand mapping in `mapping.json` |

Three repeats each. No LLM judge. The question is whether the structured
output contract costs recall relative to prose.

## Files

- `prompt-json.md`: JSON contract arm
- `prompt-prose.md`: prose arm
- `mapping.json`: maps prose fixture finding keys to defect ids
- Fixtures live under `eval/fixtures/` keyed by
  `sha256(task|role|model|repeat)` with task names
  `reviewer-output-format-json` and `reviewer-output-format-prose`
