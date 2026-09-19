import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 5;

/**
 * Living file, newest first, capped at last five sessions.
 * Older entries rolled into a one-line summary.
 */
export function appendHandoff(root, { title, body }) {
  const file = path.join(root, 'HANDOFF.md');
  const template = path.join(root, 'harness', 'templates', 'handoff.md');
  let existing = '';
  if (!fs.existsSync(file)) {
    existing = fs.existsSync(template)
      ? fs.readFileSync(template, 'utf8')
      : '# Handoff\n\nNewest session first.\n';
  } else {
    existing = fs.readFileSync(file, 'utf8');
  }

  const stamp = new Date().toISOString();
  const entry = `## ${stamp} — ${title}\n\n${body.trim()}\n`;

  // Parse entries by ## headers
  const parts = existing.split(/\n(?=## )/);
  const preamble = parts[0].startsWith('## ') ? '' : parts.shift();
  const entries = parts[0]?.startsWith('## ') ? parts : parts.filter((p) => p.startsWith('## '));

  const next = [entry, ...entries.filter((e) => e.trim())];
  let rolled = '';
  if (next.length > MAX_ENTRIES) {
    const old = next.splice(MAX_ENTRIES);
    rolled =
      `\n## Rolled summary\n\n` +
      old.map((e) => `- ${e.split('\n')[0].replace(/^##\s*/, '')}`).join('\n') +
      '\n';
  }

  const out =
    (preamble && !preamble.startsWith('## ')
      ? preamble.trimEnd() + '\n\n'
      : '# Handoff\n\nNewest session first.\n\n') +
    next.join('\n') +
    rolled;
  fs.writeFileSync(file, out);
  return file;
}
