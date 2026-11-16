import { fail, github } from './github-api.mjs';

// Get rules for a branch returns every active rule for that branch, at every
// level the rule is configured. Rulesets in evaluate or disabled enforcement
// are not returned. per_page and page are the documented query parameters.
// The example rule object has type, parameters, ruleset_source, and ruleset_id.
// https://docs.github.com/en/rest/repos/rules
//
// pull_request parameters on that page include require_code_owner_review.
// required_reviewers is a parameter of pull_request, not a separate rule type.
// This is the only definition of those names.

export const RULE_TYPES = {
  pullRequest: 'pull_request',
  requiredStatusChecks: 'required_status_checks',
};

export const MAPPED = new Set(Object.values(RULE_TYPES));

export const PULL_FIELDS = [
  ['requiredApprovingReviewCount', 'required_approving_review_count'],
  ['requireCodeOwnerReview', 'require_code_owner_review'],
  ['dismissStaleReviewsOnPush', 'dismiss_stale_reviews_on_push'],
  ['requireLastPushApproval', 'require_last_push_approval'],
];

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 */
export async function fetchBranchRules(env, owner, repo, branch) {
  const rules = [];
  for (let page = 1; page <= 10; page++) {
    const pathname =
      `/repos/${owner}/${repo}/rules/branches/${encodeURIComponent(branch)}` +
      `?per_page=100&page=${page}`;
    const batch = await github(env, pathname);
    if (!Array.isArray(batch)) throw fail('rules response is not an array');
    for (const item of batch) {
      const type = item && typeof item === 'object' && !Array.isArray(item) ? item.type : undefined;
      if (typeof type !== 'string' || type.length === 0) {
        throw fail('rules response is missing type');
      }
    }
    rules.push(...batch);
    if (batch.length < 100) break;
  }
  return rules;
}

/**
 * An active pull_request rule whose require_code_owner_review parameter is true.
 * Absent when the endpoint did not return one. Evaluate and disabled rulesets
 * are already absent from this list.
 * @param {unknown} rules
 * @returns {{ source: unknown, id: unknown } | null}
 */
export function codeOwnerRuleset(rules) {
  if (!Array.isArray(rules)) return null;
  for (const item of rules) {
    if (!item || typeof item !== 'object') continue;
    const row =
      /** @type {{ type?: string, parameters?: { require_code_owner_review?: boolean }, ruleset_source?: unknown, ruleset_id?: unknown }} */ (
        item
      );
    if (row.type !== RULE_TYPES.pullRequest) continue;
    if (row.parameters?.require_code_owner_review !== true) continue;
    return { source: row.ruleset_source, id: row.ruleset_id };
  }
  return null;
}
