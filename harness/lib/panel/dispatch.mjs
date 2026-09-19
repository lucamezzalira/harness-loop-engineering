import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveRoleBinding } from '../config.mjs';
import { invokeRole, loadRoleFile } from '../agents/invoke.mjs';
import { mergeFindings, partitionByPolicy, renderReviewTable } from './merge.mjs';
import { appendBacklog, promoteRecurring } from './backlog.mjs';
import { minimatchLike } from '../util/glob.mjs';

/**
 * @param {object} opts
 * @param {'turn'|'unit'} opts.cadence
 * @param {string[]} opts.diffFiles
 * @param {boolean} opts.unitComplete
 * @param {boolean} opts.acceptanceChanged
 */
export function selectRoles(config, opts) {
  const cadenceList = config.review?.cadence?.[opts.cadence] || ['reviewer'];
  const roles = [];
  for (const name of cadenceList) {
    if (config.roles?.[name]?.enabled === false) continue;
    if (!roleTriggered(config, name, opts)) continue;
    roles.push(name);
  }
  // reviewer always if listed
  return roles;
}

function roleTriggered(config, name, opts) {
  const triggers = config.review?.triggers || {};
  if (name === 'security') {
    const patterns = triggers.security || [];
    return opts.diffFiles.some((f) => patterns.some((p) => minimatchLike(f, p)));
  }
  if (name === 'infra') {
    const patterns = triggers.infra || [];
    return opts.diffFiles.some((f) => patterns.some((p) => minimatchLike(f, p)));
  }
  if (name === 'product') {
    if (opts.unitComplete) return true;
    if (opts.acceptanceChanged) return true;
    const patterns = triggers.product || ['specs/**'];
    return opts.diffFiles.some((f) => patterns.some((p) => minimatchLike(f, p)));
  }
  return true;
}

/**
 * Dispatch enabled roles in parallel against the same read-only diff.
 */
export async function runPanel(root, config, opts = {}) {
  const cadence = opts.cadence || 'turn';
  const diffFiles = opts.diffFiles || listDiffFiles(root, opts.sinceHash);
  const roles = selectRoles(config, {
    cadence,
    diffFiles,
    unitComplete: Boolean(opts.unitComplete),
    acceptanceChanged: Boolean(opts.acceptanceChanged),
  });

  const diffText = getDiffSince(root, opts.sinceHash);
  const findings = [];
  const roleResults = await Promise.all(
    roles.map(async (role) => {
      const binding = resolveRoleBinding(config, role);
      if (!binding) return { role, ok: false, error: 'unbound' };
      const roleMd = loadRoleFile(root, role) || `You are the ${role} reviewer.`;
      const systemPrompt = `${roleMd}\n\nReturn a JSON array only. Each item: { "category": "<from closed list>", "file": "...", "line": 0, "endLine": 0, "message": "..." }.\nNever set severity. Categories must come from harness.yaml severity keys.`;
      const userPrompt = `Review this diff (read-only). Diff files: ${diffFiles.join(', ') || '(none)'}\n\n\`\`\`diff\n${diffText.slice(0, 120_000)}\n\`\`\``;
      const result = await invokeRole({
        root,
        config,
        binding,
        systemPrompt,
        userPrompt,
        expect: 'json',
      });
      if (!result.ok) return { role, ok: false, error: result.error, usage: result.usage };
      const arr = Array.isArray(result.data) ? result.data : [];
      for (const item of arr) {
        findings.push({ ...item, role });
      }
      return { role, ok: true, count: arr.length, usage: result.usage };
    }),
  );

  const merged = mergeFindings(findings, config.severity);
  const { blocking, backlogged } = partitionByPolicy(
    merged,
    config.review?.blockAt || ['P0', 'P1'],
  );
  appendBacklog(root, config, backlogged, opts.unitId);
  promoteRecurring(root, config);

  const table = renderReviewTable({
    blocking,
    backlogged,
    unitId: opts.unitId || '-',
    cycle: opts.cycle || 1,
    diffRange: opts.diffRange || `${opts.sinceHash || '?'}..HEAD`,
  });

  const stateDir = path.join(root, 'harness', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'review.md'), table);

  return { roles, roleResults, merged, blocking, backlogged, table };
}

function listDiffFiles(root, sinceHash) {
  const args = sinceHash ? ['diff', '--name-only', sinceHash] : ['diff', '--name-only', 'HEAD'];
  // also include unstaged
  const a = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const b = spawnSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' });
  const c = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  return [
    ...new Set(
      [
        ...(a.stdout || '').split('\n'),
        ...(b.stdout || '').split('\n'),
        ...(c.stdout || '').split('\n'),
      ]
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function getDiffSince(root, sinceHash) {
  const args = sinceHash ? ['diff', sinceHash] : ['diff', 'HEAD'];
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const unstaged = spawnSync('git', ['diff'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return (res.stdout || '') + '\n' + (unstaged.stdout || '');
}
