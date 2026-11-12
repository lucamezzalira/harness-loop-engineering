/**
 * Developer authorisation for a protected check-path edit.
 * The flag only runs on an interactive terminal. Hooks and agents cannot set it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../config.mjs';
import { DEFAULT_CHECK_PATHS } from '../checks/check-integrity.mjs';
import { readSession, writeSession } from '../accounting.mjs';
import { isTTY, prompt } from '../tty.mjs';

export function checkPathsOf(root) {
  try {
    return loadConfig(root).protect?.checkPaths || DEFAULT_CHECK_PATHS;
  } catch {
    return DEFAULT_CHECK_PATHS;
  }
}

export function gitUserName(root) {
  const r = spawnSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').trim() || 'unknown';
}

export function appendCheckEditLog(root, record) {
  const file = path.join(root, 'harness', 'state', 'check-edits.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = `${record.at}\t${record.by}\t${record.sessionId}\t${record.paths.join(',')}\t${record.reason}\n`;
  fs.appendFileSync(file, line);
}

/**
 * @param {{ isTTY?: () => boolean, ask?: (q: string) => string | Promise<string>, by?: string }} [io]
 */
export async function allowCheckEdit(root, io = {}) {
  const interactive = io.isTTY ? io.isTTY() : isTTY();
  const inHook = process.env.HARNESS_IN_HOOK === '1';
  if (!interactive || inHook) {
    return {
      exitCode: 2,
      text: '--allow-check-edit requires an interactive terminal. An agent or hook cannot authorise a check edit.',
    };
  }
  const ask = io.ask || ((q) => prompt(q, { defaultAnswer: '', nonInteractive: '' }));
  const known = checkPathsOf(root);
  const answer = String(
    (await ask(`Which protected paths? ${known.join(' ')} (or all)\n> `)) || '',
  ).trim();
  if (!answer) return { exitCode: 2, text: 'no paths given' };
  const paths =
    answer === 'all'
      ? ['all']
      : answer
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
  const unknown = paths.filter((p) => p !== 'all' && !known.includes(p));
  if (unknown.length) return { exitCode: 2, text: `unknown check path: ${unknown.join(', ')}` };
  const reason = String((await ask('One-line reason\n> ')) || '').trim();
  if (!reason) return { exitCode: 2, text: 'a reason is required' };
  const session = readSession(root) || {
    id: `adhoc-${Date.now().toString(36)}`,
    profile: 'hybrid-local',
    tool: 'cursor',
    env: 'local',
    units: [],
  };
  const record = {
    paths,
    reason,
    at: new Date().toISOString(),
    by: io.by || gitUserName(root),
    sessionId: session.id,
  };
  session.explicitCheckEdit = record;
  writeSession(root, session);
  appendCheckEditLog(root, record);
  return { exitCode: 0, text: `recorded check edit for ${paths.join(', ')}`, record };
}
