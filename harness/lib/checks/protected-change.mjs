import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { addedLines } from './diff-lines.mjs';
import { DEFAULT_CHECK_PATHS, pathIsProtected } from './check-paths.mjs';
import {
  DEFAULT_HUMAN_PATHS,
  DEFAULT_HUMAN_PATTERNS,
  patternHits,
} from '../review/human-required.mjs';
import { loginOf, ownerLogins, ownersForFile, readCodeowners } from './codeowners.mjs';
import { PROTECTED_LABEL, fail, github, readGithubEvent } from './github-api.mjs';
import { codeOwnerRuleset, fetchBranchRules } from './branch-rules.mjs';

export { PROTECTED_LABEL, readGithubEvent, github };

// pull_request and pull_request_review set GITHUB_REF to the PR merge branch
// refs/pull/PULL_REQUEST_NUMBER/merge. A workflow run on those events uses the
// workflow from that merge commit, which the pull request can edit.
// https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows
//
// pull_request_target runs in the context of the default branch. This sensor
// reads harness.yaml from the checkout (the base) and diffs the fetched head
// as data. It does not import the yaml package: the workflow does not npm install.
// https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
//
// A protected path exits 0 only when branch-rules.mjs finds an active
// pull_request rule with require_code_owner_review. Otherwise the label
// decides. If the rules cannot be read, this sensor exits 2. That module
// is the only place those rule names are defined.
// https://docs.github.com/en/rest/repos/rules
export const RULESET_DECISION =
  'ruleset decides: pull request rule (require review from code owners); required reviewer rule';

const CLOSED = 'The check failed closed and the label route applies.';
const MISSING_LABEL = `label ${PROTECTED_LABEL} added by a CODEOWNERS owner`;
const MISSING_PUSH = 'direct push to the default branch with no pull request';
const MISSING_OWNER = 'a CODEOWNERS owner';
const PULL_EVENTS = new Set(['pull_request', 'pull_request_target']);

const LIST_KEYS = {
  'protect.checkPaths': 'checkPaths',
  'review.humanRequired.paths': 'paths',
  'review.humanRequired.patterns': 'patterns',
};

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

function unquote(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  return text;
}

/**
 * Read the three lists this sensor needs from harness.yaml.
 * Node has no built-in YAML parser, and this job must not npm install.
 * Only the indentation and list shape of this repo's file is read.
 * A missing key falls back to the same defaults as harness.yaml.
 */
export function listsFromHarnessYaml(text) {
  const found = {};
  const stack = [];
  let listName = '';
  let listIndent = -1;
  for (const raw of String(text || '').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const trimmed = raw.trim();
    if (listName && trimmed.startsWith('- ') && indent > listIndent) {
      found[listName].push(unquote(trimmed.slice(2)));
      continue;
    }
    listName = '';
    const key = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:/)?.[1];
    if (!key) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, key });
    const trail = stack.map((item) => item.key).join('.');
    const name = LIST_KEYS[trail];
    if (!name) continue;
    listName = name;
    listIndent = indent;
    found[name] = [];
  }
  return found;
}

function sensorConfig(root) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, 'harness.yaml'), 'utf8');
  } catch {
    text = '';
  }
  const lists = listsFromHarnessYaml(text);
  const pick = (name, fallback) => (lists[name]?.length ? lists[name] : [...fallback]);
  return {
    protect: { checkPaths: pick('checkPaths', DEFAULT_CHECK_PATHS) },
    review: {
      humanRequired: {
        paths: pick('paths', DEFAULT_HUMAN_PATHS),
        patterns: pick('patterns', DEFAULT_HUMAN_PATTERNS),
      },
    },
  };
}

function unique(items) {
  const out = [];
  for (const item of items) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function pathRulesFor(file, config) {
  const checkPaths = config?.protect?.checkPaths;
  const humanPaths = config?.review?.humanRequired?.paths || [];
  const listed = Array.isArray(checkPaths) && checkPaths.length ? checkPaths : [];
  const rules = [];
  for (const pattern of listed) {
    if (pathIsProtected(file, [pattern])) rules.push(pattern);
  }
  for (const pattern of humanPaths) {
    if (pathIsProtected(file, [pattern])) rules.push(pattern);
  }
  return unique(rules);
}

function patternRulesFor(file, diff, config) {
  const patterns = config?.review?.humanRequired?.patterns || [];
  const rules = [];
  for (const row of addedLines(diff)) {
    if (row.file !== file) continue;
    for (const pattern of patterns) {
      if (patternHits(pattern, row.text)) rules.push(pattern);
    }
  }
  return unique(rules);
}

function classifiedFiles(names, diff, config) {
  const seen = new Set(names);
  for (const row of addedLines(diff)) seen.add(row.file);
  const files = [];
  for (const file of seen) {
    const paths = pathRulesFor(file, config);
    const patterns = patternRulesFor(file, diff, config);
    if (!paths.length && !patterns.length) continue;
    files.push({ file, paths, patterns, rules: unique([...paths, ...patterns]) });
  }
  return files;
}

function span(root, base, head) {
  return {
    names: namesFrom(gitOut(root, ['diff', '--name-only', `${base}...${head}`])),
    diff: gitOut(root, ['diff', '-U0', `${base}...${head}`]),
  };
}

function labelApprover(labels, timeline, owners, cutoff) {
  const names = (labels || []).map((label) => (typeof label === 'string' ? label : label?.name));
  if (!names.includes(PROTECTED_LABEL)) return '';
  const relevant = (timeline || []).filter((event) => {
    const name = event?.label?.name;
    return name === PROTECTED_LABEL && (event.event === 'labeled' || event.event === 'unlabeled');
  });
  const last = relevant[relevant.length - 1];
  if (!last || last.event !== 'labeled') return '';
  if (cutoff && !labelIsCurrent(last.created_at, cutoff)) return '';
  const actor = loginOf(last.actor?.login);
  if (!actor || !owners.has(actor)) return '';
  return actor;
}

function labelIsCurrent(createdAt, cutoff) {
  const at = Date.parse(createdAt || '');
  const cut = Date.parse(cutoff || '');
  if (Number.isNaN(at) || Number.isNaN(cut)) return false;
  return at >= cut;
}

function synchronizeCutoff(event, pr) {
  if (event?.action !== 'synchronize') return '';
  return pr?.updated_at || event?.pull_request?.updated_at || '9999-12-31T00:00:00Z';
}

function decidePattern(file, labelActor) {
  if (!file.owners.length) {
    return { ...file, route: '', approver: '', missing: MISSING_OWNER };
  }
  if (labelActor) {
    return { ...file, route: 'label', approver: labelActor, missing: '' };
  }
  return { ...file, route: '', approver: '', missing: MISSING_LABEL };
}

function decideFile(file, labelActor, ruleset) {
  if (file.patterns.length) return decidePattern(file, labelActor);
  if (ruleset) {
    return {
      ...file,
      route: 'ruleset',
      approver: '',
      missing: '',
      rulesetSource: ruleset.source,
      rulesetId: ruleset.id,
    };
  }
  return decidePattern(file, labelActor);
}

function formatText(files, skipped) {
  if (skipped) return 'skipped (no pull request)\n';
  const lines = [];
  for (const file of files) {
    const owners = file.owners.length ? file.owners.join(', ') : '(none)';
    if (file.route === 'ruleset' && !file.missing) {
      lines.push(
        `${file.file} matched ${file.rules.join(', ')} ${RULESET_DECISION} ruleset_source ${file.rulesetSource} ruleset_id ${file.rulesetId}`,
      );
      continue;
    }
    if (file.missing) {
      lines.push(
        `${file.file} matched ${file.rules.join(', ')} owners: ${owners} missing: ${file.missing}`,
      );
      continue;
    }
    lines.push(`${file.file} approver ${file.approver} route ${file.route}`);
  }
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
  const repo = repoOf(env, event);
  if (!base || !head || !number || !repo)
    throw fail('pull request event is missing base, head, number, or repository');
  const config = sensorConfig(root);
  const range = span(root, base, head);
  const found = classifiedFiles(range.names, range.diff, config).map((file) => ({
    ...file,
    head,
  }));
  if (!found.length) return finish([]);
  const codeowners = readCodeowners(root);
  const withOwners = found.map((file) => ({
    ...file,
    owners: ownersForFile(codeowners, file.file),
  }));
  const pathFiles = withOwners.filter((file) => file.paths.length && !file.patterns.length);
  const ruleset = await readCodeOwnerRuleset(env, event, pr);
  const needsLabel =
    withOwners.some((file) => file.patterns.length) || (pathFiles.length > 0 && !ruleset);
  let labelActor = '';
  if (needsLabel && env.GITHUB_TOKEN) {
    const [labels, timeline] = await Promise.all([
      github(env, `/repos/${repo}/issues/${number}/labels`),
      github(env, `/repos/${repo}/issues/${number}/timeline`),
    ]);
    labelActor = labelApprover(
      labels,
      timeline,
      ownerLogins(codeowners),
      synchronizeCutoff(event, pr),
    );
  }
  return finish(withOwners.map((file) => decideFile(file, labelActor, ruleset)));
}

function unread(cause) {
  const text = String(cause || 'rules response could not be read').trim();
  throw fail(text.endsWith(CLOSED) ? text : `${text} ${CLOSED}`);
}

async function readCodeOwnerRuleset(env, event, pr) {
  if (!env.GITHUB_TOKEN) unread('GITHUB_TOKEN is missing.');
  const branch = pr?.base?.ref || event?.repository?.default_branch;
  if (!branch) unread('pull request base branch is missing.');
  const repo = repoOf(env, event);
  const slash = repo.indexOf('/');
  if (slash <= 0) unread('repository is missing.');
  try {
    const rules = await fetchBranchRules(env, repo.slice(0, slash), repo.slice(slash + 1), branch);
    return codeOwnerRuleset(rules);
  } catch (err) {
    unread(err instanceof Error ? err.message : String(err));
  }
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
  const config = sensorConfig(root);
  const range = span(root, before, sha);
  const found = classifiedFiles(range.names, range.diff, config).map((file) => ({
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
  } else if (!PULL_EVENTS.has(name)) {
    throw fail(`unsupported GitHub event ${name || '(none)'}`);
  }
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
      const message = err.message || String(err);
      try {
        writeBody(root, { status: 'fail', reason: message, files: [] });
      } catch {
        // The exit code is the decision. A state-file write must not hide it.
      }
      console.error(message);
      process.exit(err.exitCode || 2);
    });
}
