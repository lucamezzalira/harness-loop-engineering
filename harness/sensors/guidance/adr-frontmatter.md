# adr-frontmatter

Every `docs/adr/NNNN-*.md` must have valid YAML frontmatter with required fields,
a four-digit id matching the filename, and consistent supersession links.

Fix: restore required fields, or run `node scripts/build-adr-index.mjs` after
correcting `supersedes` / `superseded-by`.
