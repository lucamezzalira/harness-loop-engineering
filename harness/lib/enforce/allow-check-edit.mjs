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
import { checkEditLogLine } from './check-edit-record.mjs';
import { newAdhocSession } from './adhoc-session.mjs';

/**
 * Set when a tool spawned this process to run a shell command.
 * Any non-empty value refuses --allow-check-edit.
 *
 * Claude Code sets CLAUDECODE=1 on Bash and PowerShell tool commands, tmux
 * sessions, hook commands, the status line, and stdio MCP subprocesses.
 * IDE extensions also set CLAUDECODE in their integrated terminals, so a
 * person typing in that terminal is refused too. CLAUDE_CODE_CHILD_SESSION=1
 * is set only when Claude Code itself launches a Bash, PowerShell, or Monitor
 * tool command, a hook, or the status line (not an MCP server, and not an
 * IDE terminal). Both are documented:
 * https://code.claude.com/docs/en/env-vars
 *
 * Cursor documents CURSOR_AGENT for agent terminal sessions and tells shell
 * config to test that it is non-empty, not that it equals a particular value:
 * https://cursor.com/docs/agent/tools/terminal
 * The Cursor CLI sets it to 1 on commands it runs. Cursor hooks and MCP
 * servers are not documented as receiving CURSOR_AGENT or any other agent
 * marker. There is no second Cursor variable to check. A hook that runs
 * without CURSOR_AGENT is still refused by HARNESS_IN_HOOK=1.
 */
export const AGENT_ENV_MARKERS = Object.freeze([
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CURSOR_AGENT',
]);

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string} the marker name, or '' when none is set
 */
export function agentMarkerSet(env = process.env) {
  for (const name of AGENT_ENV_MARKERS) {
    if (env[name]) return name;
  }
  return '';
}

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
  fs.appendFileSync(file, checkEditLogLine(record));
}

/**
 * @param {string} root
 * @param {{ isTTY?: () => boolean, ask?: (q: string) => string | Promise<string>, by?: string, env?: NodeJS.ProcessEnv }} [io]
 */
export async function allowCheckEdit(root, io = {}) {
  const env = io.env || process.env;
  const interactive = io.isTTY ? io.isTTY() : isTTY();
  const marker = agentMarkerSet(env);
  const inHook = env.HARNESS_IN_HOOK === '1';
  if (marker || inHook || !interactive) {
    const why = marker
      ? `agent environment marker ${marker} is set`
      : inHook
        ? 'HARNESS_IN_HOOK=1'
        : 'no interactive terminal';
    return {
      exitCode: 2,
      text: `--allow-check-edit requires an interactive terminal. An agent or hook cannot authorise a check edit. (${why})`,
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
  const reason = String((await ask('One-line reason\n> ')) || '')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
  if (!reason) return { exitCode: 2, text: 'a reason is required' };
  const session = readSession(root) || newAdhocSession(root, env);
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
  return {
    exitCode: 0,
    text: `recorded check edit for ${paths.join(', ')}. Early warning only; CI protected-change decides on the pull request.`,
    record,
  };
}
