import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROTECTED_LABEL, github, readGithubEvent } from './github-api.mjs';

export async function clearProtectedLabel(env = process.env) {
  const name = env.GITHUB_EVENT_NAME || '';
  const event = readGithubEvent(env);
  // pull_request_target uses the pull_request payload. synchronize is one of its
  // activity types. The workflow file for that event comes from the default branch.
  // https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows
  if (
    (name !== 'pull_request' && name !== 'pull_request_target') ||
    event.action !== 'synchronize'
  ) {
    return { exitCode: 0, text: 'clear-protected-label skipped\n' };
  }
  const number = event.pull_request?.number;
  const repo = env.GITHUB_REPOSITORY || event.repository?.full_name;
  if (!number || !repo) {
    throw Object.assign(new Error('synchronize event is missing the pull request'), {
      exitCode: 2,
    });
  }
  const label = encodeURIComponent(PROTECTED_LABEL);
  await github(env, `/repos/${repo}/issues/${number}/labels/${label}`, { method: 'DELETE' });
  return { exitCode: 0, text: `cleared ${PROTECTED_LABEL}\n` };
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  clearProtectedLabel(process.env)
    .then((result) => {
      process.stdout.write(result.text);
      process.exit(result.exitCode);
    })
    .catch((err) => {
      console.error(err.message || String(err));
      process.exit(err.exitCode || 2);
    });
}
