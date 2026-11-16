import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fail, readGithubEvent } from './github-api.mjs';
import { MAPPED, PULL_FIELDS, RULE_TYPES, fetchBranchRules } from './branch-rules.mjs';

// Get a repository ruleset: bypass_actors is returned only when the caller
// has write access to the ruleset. The branch-rules example has no
// bypass_actors field. This sensor never treats that absence as an empty list.
// Rule types and parameter names come from branch-rules.mjs.
// https://docs.github.com/en/rest/repos/rules

export const BYPASS_LINE = 'bypass list not visible to this token, check Settings';

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root
 */
export async function evaluatePlatformRules(env, root) {
  const expected = expectedFrom(root);
  const event = readGithubEvent(env);
  const branch = event?.repository?.default_branch;
  if (!branch) throw fail('repository.default_branch is missing');
  const repo = String(env.GITHUB_REPOSITORY || '');
  const slash = repo.indexOf('/');
  if (slash <= 0) throw fail('GITHUB_REPOSITORY is missing');
  const rules = await fetchBranchRules(env, repo.slice(0, slash), repo.slice(slash + 1), branch);
  return judge(rules, expected);
}

function expectedFrom(root) {
  const file = path.join(root, 'harness.yaml');
  const doc = fs.existsSync(file) ? parseYaml(fs.readFileSync(file, 'utf8')) || {} : {};
  const platform = doc.platform || {};
  const pull = platform.pullRequest || {};
  const reviewers = platform.requiredReviewers || {};
  const patterns = unique([
    ...(doc.protect?.checkPaths || []),
    ...(doc.review?.humanRequired?.paths || []),
  ]);
  return {
    mode: platform.mode === 'block' ? 'block' : 'warn',
    pullRequest: {
      requiredApprovingReviewCount: pull.requiredApprovingReviewCount,
      requireCodeOwnerReview: pull.requireCodeOwnerReview,
      dismissStaleReviewsOnPush: pull.dismissStaleReviewsOnPush,
      requireLastPushApproval: pull.requireLastPushApproval,
    },
    requiredStatusChecks: platform.requiredStatusChecks || [],
    requiredReviewers: { minimumApprovals: reviewers.minimumApprovals },
    filePatterns: patterns,
  };
}

function judge(rules, expected) {
  const lines = [BYPASS_LINE];
  const problems = [];
  for (const rule of rules) {
    const type = rule && typeof rule.type === 'string' ? rule.type : 'unnamed';
    if (!MAPPED.has(type)) lines.push(`unknown ${type}`);
  }
  const pull = rules.find((rule) => rule && rule.type === RULE_TYPES.pullRequest);
  if (!pull) {
    problems.push(`missing ${RULE_TYPES.pullRequest}`);
    for (const [key, api] of PULL_FIELDS) {
      if (expected.pullRequest[key] === undefined) continue;
      problems.push(`missing ${RULE_TYPES.pullRequest} ${api}`);
    }
    problems.push(...reviewerProblems({}, expected));
  } else {
    const params = pull.parameters || {};
    for (const [key, api] of PULL_FIELDS) {
      const want = expected.pullRequest[key];
      if (want === undefined) continue;
      if (params[api] !== want) {
        problems.push(`${RULE_TYPES.pullRequest} ${api} is ${shown(params[api])}`);
      }
    }
    problems.push(...reviewerProblems(params, expected));
  }
  const status = rules.find((rule) => rule && rule.type === RULE_TYPES.requiredStatusChecks);
  const contexts = new Set(
    (status?.parameters?.required_status_checks || []).map((check) => check?.context),
  );
  for (const name of expected.requiredStatusChecks) {
    if (!contexts.has(name)) problems.push(`missing ${RULE_TYPES.requiredStatusChecks} ${name}`);
  }
  lines.push(...problems);
  const exitCode = problems.length > 0 && expected.mode === 'block' ? 1 : 0;
  return { exitCode, lines };
}

function reviewerProblems(params, expected) {
  const problems = [];
  const reviewers = Array.isArray(params.required_reviewers) ? params.required_reviewers : [];
  const min = expected.requiredReviewers.minimumApprovals;
  if (min !== undefined && !reviewers.some((entry) => entry && entry.minimum_approvals === min)) {
    problems.push(`missing ${RULE_TYPES.pullRequest} required_reviewers minimum_approvals`);
  }
  for (const entry of reviewers) {
    const type = entry?.reviewer?.type;
    if (type && type !== 'Team') {
      problems.push(`${RULE_TYPES.pullRequest} required_reviewers reviewer.type is ${shown(type)}`);
    }
  }
  const patterns = new Set(
    reviewers.flatMap((entry) => (Array.isArray(entry?.file_patterns) ? entry.file_patterns : [])),
  );
  for (const glob of expected.filePatterns) {
    if (!patterns.has(glob)) {
      problems.push(`missing ${RULE_TYPES.pullRequest} required_reviewers file_patterns ${glob}`);
    }
  }
  return problems;
}

function shown(value) {
  if (value === undefined) return 'absent';
  return JSON.stringify(value);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value)))];
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const root = process.env.HARNESS_ROOT || process.cwd();
  evaluatePlatformRules(process.env, root)
    .then((result) => {
      for (const line of result.lines) console.log(line);
      process.exit(result.exitCode);
    })
    .catch((err) => {
      console.log(BYPASS_LINE);
      console.error(err.message || String(err));
      process.exit(err.exitCode || 2);
    });
}
