import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readReport, writeReport } from '../report.mjs';

// Names only. The warning never includes a value from the environment or from .env.
export const CREDENTIAL_ENV = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'KUBECONFIG',
  'DATABASE_URL',
];

export const NO_KNOWN = 'no known credentials visible';
export const UNSEEN =
  'cannot see credentials in files it does not know about, keychains, or SSO caches';

/**
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 */
export function collectCredentials(root, env = process.env) {
  const visible = [];
  for (const name of CREDENTIAL_ENV) {
    if (env[name]) visible.push(name);
  }
  const login = ghLogin(env);
  if (login) visible.push(`gh login ${login}`);
  if (envReadable(root)) visible.push('.env');
  const lines = [];
  if (visible.length === 0) lines.push(NO_KNOWN);
  else lines.push(`credentials visible: ${visible.join(', ')}`);
  lines.push(UNSEEN);
  return { visible, unseen: UNSEEN, text: lines.join('\n') };
}

/**
 * Merges the warning onto report.json. A write failure stays inside this function.
 * @param {string} root
 * @param {{ visible: string[], unseen: string, text: string }} credentials
 */
export function recordCredentials(root, credentials) {
  try {
    const current = readReport(root) || {};
    current.credentials = credentials;
    writeReport(root, current);
  } catch {
    // Session start still exits 0. The warning is not a gate.
  }
}

function envReadable(root) {
  try {
    fs.accessSync(path.join(root, '.env'), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function ghLogin(env) {
  try {
    const result = spawnSync('gh', ['auth', 'status'], {
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status !== 0) return null;
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = text.match(/account\s+(\S+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
