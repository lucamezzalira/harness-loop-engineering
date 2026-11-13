import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.mjs';
import { addedLines, pathIsProtected } from './check-integrity.mjs';
import { humanRequiredConfig, patternHits } from '../review/human-required.mjs';
import { minimatchLike } from '../util/glob.mjs';
import { loginOf, ownerLogins, ownersForFile, readCodeowners } from './codeowners.mjs';
import { PROTECTED_LABEL, fail, github, readGithubEvent } from './github-api.mjs';

export { PROTECTED_LABEL, readGithubEvent, github };

const MISSING_REVIEW = 'APPROVED review on the head SHA from an owner who is not the author';
const MISSING_LABEL = `label ${PROTECTED_LABEL} added by a CODEOWNERS owner`;
const MISSING_PUSH = 'direct push to the default branch with no pull request';
const MISSING_OWNER = 'a CODEOWNERS owner';

function gitOut(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw fail((result.stderr || `git ${args.join(' ')}`).trim());
  return result.stdout || '';
}

function namesFrom(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function repoOf(env, event) {
  return env.GITHUB_REPOSITORY || event?.repository?.full_name || '';
}

function rulesForFile(file, diff, config) {
  const rules = [];
  const checkPaths = config?.protect?.checkPaths;
  const paths = Array.isArray(checkPaths) && checkPaths.length ? checkPaths : [];
  const { paths: humanPaths, patterns } = humanRequiredConfig(config);
  const listed = paths.length ? paths : humanPaths;
  for (const pattern of listed) {
    if (pathIsProtected(file, [pattern]) && !rules.includes(pattern)) rules.push(pattern);
  }
  for (const pattern of humanPaths) {
    if (minimatchLike(file, pattern) && !rules.includes(pattern)) rules.push(pattern);
  }
  for (const row of addedLines(diff)) {
    if (row.file !== file) continue;
    for (const pattern of patterns) {
      if (patternHits(pattern, row.text) && !rules.includes(pattern)) rules.push(pattern);
    }
  }
  return rules;
}

function protectedFiles(names, diff, config) {
  const seen = new Set(names);
  for (const row of addedLines(diff)) seen.add(row.file);
  const files = [];
  for (const file of seen) {
    const rules = rulesForFile(file, diff, config);
    if (rules.length) files.push({ file, rules });
  }
  return files;
}

function span(root, base, head) {
  return {
    names: namesFrom(gitOut(root, ['diff', '--name-only', `${base}...${head}`])),
    diff: gitOut(root, ['diff', '-U0', `${base}...${head}`]),
  };
}

function isSolo(owners, author) {
  return owners.length === 1 && owners[0] === author;
}

function latestReviews(reviews) {
  const byUser = new Map();
  for (const review of reviews || []) {
    const login = loginOf(review?.user?.login);
    if (!login) continue;
    const at = Date.parse(review.submitted_at || '') || 0;
    const prev = byUser.get(login);
    if (!prev || at >= prev.at) byUser.set(login, { at, review });
  }
  return [...byUser.values()].map((row) => row.review);
}

function reviewApprover(reviews, owners, author, head) {
  for (const review of latestReviews(reviews)) {
    const login = loginOf(review?.user?.login);
    if (!login || login === author) continue;
    if (review.state !== 'APPROVED') continue;
    if (review.commit_id !== head) continue;
    if (!owners.includes(login)) continue;
    return login;
  }
  return '';
}

function labelApprover(labels, timeline, owners) {
  const names = (labels || []).map((label) => (typeof label === 'string' ? label : label?.name));
  if (!names.includes(PROTECTED_LABEL)) return '';
  const relevant = (timeline || []).filter((event) => {
    const name = event?.label?.name;
    return name === PROTECTED_LABEL && (event.event === 'labeled' || event.event === 'unlabeled');
  });
  const last = relevant[relevant.length - 1];
  if (!last || last.event !== 'labeled') return '';
  const actor = loginOf(last.actor?.login);
  if (!actor || !owners.has(actor)) return '';
  return actor;
}

function decideFile(file, owners, author, reviews, labelActor) {
  if (!owners.length) {
    return { ...file, owners, route: '', approver: '', missing: MISSING_OWNER };
  }
  if (isSolo(owners, author)) {
    if (labelActor) {
      return { ...file, owners, route: 'label', approver: labelActor, missing: '' };
    }
    return { ...file, owners, route: '', approver: '', missing: MISSING_LABEL };
  }
  const approver = reviewApprover(reviews, owners, author, file.head);
  if (approver) return { ...file, owners, route: 'review', approver, missing: '' };
  return { ...file, owners, route: '', approver: '', missing: MISSING_REVIEW };
}

function formatText(files, skipped) {
  if (skipped) return 'skipped (no pull request)\n';
  const lines = files.map((file) => {
    const owners = file.owners.length ? file.owners.join(', ') : '(none)';
    if (file.missing) {
      return `${file.file} matched ${file.rules.join(', ')} owners: ${owners} missing: ${file.missing}`;
    }
    return `${file.file} approver ${file.approver} route ${file.route}`;
  });
  if (files.every((file) => !file.missing)) lines.push('protected-change ok');
  return lines.join('\n') + '\n';
}

function finish(files, { skipped = false, pushMissing = false } = {}) {
  const decided = files.map((file) =>
    pushMissing
      ? { ...file, owners: file.owners || [], route: '', approver: '', missing: MISSING_PUSH }
      : file,
  );
  const failed = decided.some((file) => file.missing);
  return {
    exitCode: skipped || !failed ? 0 : 1,
    text: formatText(decided, skipped),
    body: {
      status: skipped ? 'skipped' : failed ? 'fail' : 'pass',
      reason: skipped ? 'skipped (no pull request)' : '',
      files: decided,
    },
  };
}

async function evaluatePull(root, env, event, pr) {
  const base = pr?.base?.sha;
  const head = pr?.head?.sha;
  const number = pr?.number;
  const author = loginOf(pr?.user?.login);
  const repo = repoOf(env, event);
  if (!base || !head || !number || !repo)
    throw fail('pull request event is missing base, head, number, or repository');
  const config = loadConfig(root);
  const range = span(root, base, head);
  const found = protectedFiles(range.names, range.diff, config).map((file) => ({ ...file, head }));
  if (!found.length) return finish([]);
  const codeowners = readCodeowners(root);
  const withOwners = found.map((file) => ({
    ...file,
    owners: ownersForFile(codeowners, file.file),
  }));
  const solo = withOwners.some((file) => isSolo(file.owners, author));
  const reviewed = withOwners.some((file) => file.owners.length && !isSolo(file.owners, author));
  const reviews = reviewed ? await github(env, `/repos/${repo}/pulls/${number}/reviews`) : [];
  let labelActor = '';
  if (solo) {
    const [labels, timeline] = await Promise.all([
      github(env, `/repos/${repo}/issues/${number}/labels`),
      github(env, `/repos/${repo}/issues/${number}/timeline`),
    ]);
    labelActor = labelApprover(labels, timeline, ownerLogins(codeowners));
  }
  const decided = withOwners.map((file) =>
    decideFile(file, file.owners, author, reviews, labelActor),
  );
  return finish(decided);
}

async function evaluatePush(root, env, event) {
  const branch = event.repository?.default_branch || 'main';
  const ref = event.ref || '';
  if (ref !== `refs/heads/${branch}`) return finish([], { skipped: true });
  const repo = repoOf(env, event);
  const sha = event.after || env.GITHUB_SHA;
  if (!repo || !sha) throw fail('push event is missing repository or sha');
  const pulls = await github(env, `/repos/${repo}/commits/${sha}/pulls`);
  if (Array.isArray(pulls) && pulls.length) return evaluatePull(root, env, event, pulls[0]);
  const before = event.before;
  if (!before || /^0+$/.test(before)) throw fail('push to the default branch has no base commit');
  const config = loadConfig(root);
  const range = span(root, before, sha);
  const found = protectedFiles(range.names, range.diff, config).map((file) => ({
    ...file,
    owners: ownersForFile(readCodeowners(root), file.file),
  }));
  if (!found.length) return finish([]);
  return finish(found, { pushMissing: true });
}

export async function evaluateProtectedChange(root, env = process.env) {
  const name = env.GITHUB_EVENT_NAME || '';
  const event = readGithubEvent(env);
  if (name === 'push') {
    const branch = event.repository?.default_branch || 'main';
    if ((event.ref || '') !== `refs/heads/${branch}`) return finish([], { skipped: true });
  } else if (name !== 'pull_request' && name !== 'pull_request_review') {
    throw fail(`unsupported GitHub event ${name || '(none)'}`);
  }
  if (!env.GITHUB_TOKEN) throw fail('GITHUB_TOKEN is missing');
  if (name === 'push') return evaluatePush(root, env, event);
  return evaluatePull(root, env, event, event.pull_request);
}

function writeBody(root, body) {
  const dir = path.join(root, 'harness', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'protected-change.json'), JSON.stringify(body, null, 2) + '\n');
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const root = process.env.HARNESS_ROOT || process.cwd();
  evaluateProtectedChange(root, process.env)
    .then((result) => {
      writeBody(root, result.body);
      process.stdout.write(result.text);
      process.exit(result.exitCode);
    })
    .catch((err) => {
      console.error(err.message || String(err));
      process.exit(err.exitCode || 2);
    });
}
