import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * acceptance: passes:true must name a test that exists and ran green;
 * entries may be added but never removed vs HEAD.
 */
export async function run({ root, config }) {
  const specsDir = path.join(root, 'specs');
  if (!fs.existsSync(specsDir)) {
    return { status: 'skipped', reason: 'no specs/ directory (no active spec)' };
  }

  const active = [];
  for (const slug of fs.readdirSync(specsDir)) {
    const acc = path.join(specsDir, slug, 'acceptance.json');
    if (fs.existsSync(acc)) active.push({ slug, acc });
  }
  if (!active.length) {
    return { status: 'skipped', reason: 'no active spec acceptance.json' };
  }

  const failures = [];
  for (const { slug, acc } of active) {
    const current = JSON.parse(fs.readFileSync(acc, 'utf8'));
    const entries = Array.isArray(current) ? current : current.entries || [];

    // Compare to HEAD version if tracked
    const head = spawnSync('git', ['show', `HEAD:${path.relative(root, acc)}`], {
      cwd: root,
      encoding: 'utf8',
    });
    if (head.status === 0 && head.stdout.trim()) {
      try {
        const prev = JSON.parse(head.stdout);
        const prevEntries = Array.isArray(prev) ? prev : prev.entries || [];
        const prevIds = new Set(prevEntries.map((e) => e.id));
        const curIds = new Set(entries.map((e) => e.id));
        for (const id of prevIds) {
          if (!curIds.has(id)) {
            failures.push(`${slug}: acceptance entry ${id} removed vs HEAD (forbidden)`);
          }
        }
      } catch {
        /* ignore parse */
      }
    }

    for (const entry of entries) {
      if (!entry.passes) continue;
      if (!entry.test) {
        failures.push(`${slug}/${entry.id}: passes:true but no test named`);
        continue;
      }
      const testPath = path.isAbsolute(entry.test) ? entry.test : path.join(root, entry.test);
      // test field may be "file:name" or just file
      const filePart = entry.test.split(':')[0];
      const abs = path.join(root, filePart);
      if (!fs.existsSync(abs) && !fs.existsSync(testPath)) {
        failures.push(`${slug}/${entry.id}: passes:true names missing test ${entry.test}`);
        continue;
      }
      // Require unit report green in latest report if present
      const reportPath = path.join(root, 'harness', 'state', 'report.json');
      if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const unit = report.checks?.find((c) => c.name === 'unit');
        if (unit && unit.status === 'fail') {
          failures.push(
            `${slug}/${entry.id}: passes:true requires a green unit run; unit last failed`,
          );
        }
      }
    }
  }

  if (failures.length) {
    return { status: 'fail', exitCode: 1, output: failures.join('\n') };
  }
  return { status: 'pass', exitCode: 0, output: 'acceptance claims consistent' };
}
