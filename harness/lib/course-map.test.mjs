import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('A-34 every course-map link resolves and failure modes name the new stops', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const start = readme.indexOf('## Course map');
  const end = readme.indexOf('\n## ', start + 5);
  assert.ok(start >= 0);
  const section = readme.slice(start, end > start ? end : undefined);
  const links = [...section.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 15, `found ${links.length} links`);
  for (const link of links) {
    const abs = path.resolve(ROOT, link.split('#')[0]);
    assert.equal(fs.existsSync(abs), true, link);
  }
  const modes = fs.readFileSync(path.join(ROOT, 'docs', 'loop-failure-modes.md'), 'utf8');
  assert.match(modes, /Silent no-op/);
  assert.match(modes, /The agent edits checks/);
  assert.match(modes, /Human-required paths/);
});
