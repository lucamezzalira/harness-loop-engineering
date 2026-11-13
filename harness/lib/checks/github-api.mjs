import fs from 'node:fs';

export const PROTECTED_LABEL = 'protected-change-approved';

export function fail(message) {
  return Object.assign(new Error(message), { exitCode: 2 });
}

export function readGithubEvent(env) {
  const file = env.GITHUB_EVENT_PATH;
  if (!file) throw fail('GITHUB_EVENT_PATH is missing');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw fail(`cannot read GITHUB_EVENT_PATH: ${err.message}`);
  }
}

function apiBase(env) {
  return String(env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
}

export async function github(env, pathname, { method = 'GET' } = {}) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw fail('GITHUB_TOKEN is missing');
  const response = await fetch(`${apiBase(env)}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'harness-protected-change',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (method === 'DELETE' && (response.ok || response.status === 404)) return null;
  if (!response.ok) throw fail(`GitHub API ${response.status} for ${pathname}`);
  if (response.status === 204) return null;
  return response.json();
}
