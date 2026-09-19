import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * Tree hash from `git ls-files -s` plus working-tree diff.
 * Never use mtimes: rebase changes timestamps without changing content.
 * @param {string} root
 */
export function computeTreeHash(root) {
  const ls = spawnSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8' });
  const diff = spawnSync('git', ['diff', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });

  let payload = '';
  if (ls.status === 0) payload += ls.stdout;
  if (diff.status === 0) payload += '\n---DIFF---\n' + diff.stdout;
  if (untracked.status === 0 && untracked.stdout.trim()) {
    payload += '\n---UNTRACKED---\n' + untracked.stdout;
    for (const rel of untracked.stdout.split('\n').filter(Boolean)) {
      const abs = path.join(root, rel);
      try {
        if (fs.statSync(abs).isFile()) {
          payload += `\n#${rel}\n` + fs.readFileSync(abs);
        }
      } catch {
        /* ignore */
      }
    }
  }

  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
