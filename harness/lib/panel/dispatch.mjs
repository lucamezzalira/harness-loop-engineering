import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveRoleBinding } from '../config.mjs';
import { invokeRole, loadRoleFile } from '../agents/invoke.mjs';
import { mergeFindings, renderReviewTable } from './merge.mjs';
import { reviewMode, routeFindings } from './trust.mjs';
import { appendBacklog, promoteRecurring } from './backlog.mjs';
import { reconcileFindings } from './outcomes.mjs';
import { readSession, writeSession } from '../accounting.mjs';
import { minimatchLike } from '../util/glob.mjs';

/**
 * @param {object} opts
 * @param {'turn'|'unit'|'wave'|'ship'} opts.cadence
 * @param {string[]} opts.diffFiles
 * @param {boolean} opts.unitComplete
 * @param {boolean} opts.acceptanceChanged
 */
export function selectRoles(config, opts) {
  const cadence = opts.cadence || 'turn';
  const cadenceList =
    config.review?.cadence?.[cadence] ||
    (cadence === 'ship' || cadence === 'wave'
      ? config.review?.cadence?.unit || ['reviewer']
      : ['reviewer']);
  const roles = [];
  for (const name of cadenceList) {
    if (config.roles?.[name]?.enabled === false) continue;
    if (!roleTriggered(config, name, opts)) continue;
    roles.push(name);
  }
  return roles;
}

function roleTriggered(config, name, opts) {
  const triggers = config.review?.triggers || {};
  const pathTriggered = (key, fallback = []) => {
    const patterns = triggers[key] || fallback;
    if (!patterns.length) return false;
    return opts.diffFiles.some((f) => patterns.some((p) => minimatchLike(f, p)));
  };

  if (name === 'security') {
    // Always on unit complete / unit cadence.
    if (opts.unitComplete || opts.cadence === 'unit') return true;
    return pathTriggered('security');
  }
  if (name === 'infra') return pathTriggered('infra');
  if (name === 'performance') {
    return pathTriggered('performance', [
      'services/**',
      'examples/**',
      '**/webpack*.{js,cjs,mjs,ts}',
    ]);
  }
  if (name === 'product') {
    if (opts.unitComplete) return true;
    if (opts.acceptanceChanged) return true;
    return pathTriggered('product', ['specs/**']);
  }
  if (name === 'qa') {
    return (
      opts.unitComplete ||
      opts.cadence === 'wave' ||
      opts.cadence === 'ship' ||
      opts.cadence === 'unit'
    );
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
  const findingsByRole = new Map();
  const roleResults = await Promise.all(
    roles.map(async (role) => {
      const binding = resolveRoleBinding(config, role);
      if (!binding) return { role, ok: false, error: 'unbound' };
      const roleMd = loadRoleFile(root, role) || `You are the ${role} reviewer.`;
      const systemPrompt = systemPromptForRole(roleMd);
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
      const arr = findingsFromRoleOutput(result.data);
      const tagged = arr.map((item) => ({ ...item, role }));
      findingsByRole.set(role, tagged);
      return { role, ok: true, count: arr.length, usage: result.usage };
    }),
  );

  const blockAt = config.review?.blockAt || ['P0', 'P1'];
  const blocking = [];
  const backlogged = [];
  const shadow = [];
  for (const role of roles) {
    const raw = findingsByRole.get(role) || [];
    const mergedRole = mergeFindings(raw, config.severity);
    const routed = routeFindings(mergedRole, reviewMode(config, role), blockAt);
    blocking.push(...routed.blocking);
    backlogged.push(...routed.backlogged);
    shadow.push(...routed.shadow);
  }
  appendBacklog(root, config, backlogged, opts.unitId);
  promoteRecurring(root, config);

  const table = renderReviewTable({
    blocking,
    backlogged,
    shadow,
    unitId: opts.unitId || '-',
    cycle: opts.cycle || 1,
    diffRange: opts.diffRange || `${opts.sinceHash || '?'}..HEAD`,
  });

  const stateDir = path.join(root, 'harness', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'review.md'), table);

  const merged = [...blocking, ...backlogged, ...shadow];
  const session = readSession(root) || { id: 'adhoc', reviewFindings: [] };
  session.reviewFindings = reconcileFindings(session.reviewFindings || [], merged, diffFiles);
  writeSession(root, session);
  return {
    roles,
    roleResults,
    merged,
    blocking,
    backlogged,
    shadow,
    table,
    reviewFindings: session.reviewFindings,
  };
}

/**
 * Roles that declare a `verdict` object keep that contract.
 * Other roles still return a findings array.
 */
export function systemPromptForRole(roleMd) {
  if (typeof roleMd === 'string' && /\bverdict\b/.test(roleMd)) return roleMd;
  return `${roleMd}\n\nReturn a JSON array only. Each item: { "category": "<from closed list>", "file": "...", "line": 0, "endLine": 0, "message": "..." }.\nNever set severity. Categories must come from harness.yaml severity keys.`;
}

/**
 * Panel findings from a role payload: a findings array, an integrity
 * `{verdict, findings}` object, or failed acceptance criteria.
 */
export function findingsFromRoleOutput(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.findings)) return data.findings;
  if (Array.isArray(data.criteria)) {
    return data.criteria
      .filter((c) => String(c?.status || '').toUpperCase() === 'FAIL')
      .map((c) => ({
        category: 'acceptance-unmet',
        file: c.file || '',
        line: Number(c.line) || 0,
        message: `${c.id || 'criterion'}: ${c.evidence || 'no evidence'}`,
      }));
  }
  return [];
}

function listDiffFiles(root, sinceHash) {
  const args = sinceHash ? ['diff', '--name-only', sinceHash] : ['diff', '--name-only', 'HEAD'];
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
