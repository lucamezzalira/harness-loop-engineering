import { loadConfig } from '../config.mjs';
import { resolveHarnessEnv } from '../checks/common.mjs';

/**
 * Fallback session for --allow-check-edit and --backlog triage.
 * profile and tool come from loadConfig. env comes from HARNESS_ENV
 * (unset means local, the same rule as the rest of the harness).
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 */
export function newAdhocSession(root, env = process.env) {
  const config = loadConfig(root);
  let harnessEnv = 'local';
  try {
    harnessEnv = resolveHarnessEnv(env);
  } catch {
    harnessEnv = 'local';
  }
  return {
    id: `adhoc-${Date.now().toString(36)}`,
    profile: config.profile || 'default',
    tool: config.tool ?? null,
    env: harnessEnv,
    units: [],
    dismissedByRole: {},
    reviewFindings: [],
  };
}
