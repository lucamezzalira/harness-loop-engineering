# Rules guide

How to write a standing constraint under `harness/render/rules/`. Start from
`TEMPLATE.md`. Shape is enforced by the `rule-shape` sensor.

## Scope decision (do this first)

Whether a rule is always-on or scoped by a glob is the first decision when
writing it. Everything else follows from that choice.

### Always-on (no `globs`, or `alwaysApply: true`)

Use when:

- The constraint concerns something the agent might do anywhere in the tree
  (committing secrets, calling out past boundary rules, bypassing the ship gate)
- The cost of missing a violation is high enough to justify reading the rule on
  every task
- There is no useful path pattern, because the rule is about a class of action
  rather than a class of file

### Scoped (`globs` present, `alwaysApply` omitted or false)

Use when:

- The constraint only holds inside a specific area (`services/*/consumers/`,
  `db/migrations/`, `apps/*/pages/`)
- Reading the rule on every task would waste context on tasks that never touch
  those files
- The rule refers to symbols, imports, or patterns that only make sense in the
  scoped area

**When in doubt, scope it.** An always-on rule pays its cost on every task.
Rule following degrades as instruction counts rise, and long always-on files
make that worse. A scoped rule pays nothing outside its scope.

Never set both a non-empty `globs` field and `alwaysApply: true`. That ambiguity
causes silent failures.

## Body contract

1. **H1** short imperative (no "and"; one constraint per file).
2. **First paragraph** in EARS form: "When X, the system shall Y, because Z."
3. **`## Signals of violation`** at least two concrete, present-tense bullets a
   reviewer can spot in a diff.
4. **`## How to satisfy it`** name a helper or show a short snippet. "Just don't"
   is not enough.

### Weak vs strong (EARS)

Weak: "Handle errors properly in consumers."

Strong: "When a consumer's side effect fails, the system shall not acknowledge
the message, because an acknowledged failure is a lost message and cannot be
replayed."

## Where files live

Canonical sources: `harness/render/rules/*.md` (except `TEMPLATE.md`).
`./verify.sh --render` copies them into the active tool adapter
(`.cursor/rules/`, `.claude/rules/`, or `.codex/rules/`).
