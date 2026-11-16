import { minimatchLike } from '../util/glob.mjs';

export const DEFAULT_CHECK_PATHS = Object.freeze([
  'harness/sensors/**',
  'harness/lib/enforce/**',
  'harness/lib/checks/**',
  'verify.sh',
  'harness.yaml',
  'harness/sensors/sensors.yaml',
  'eslint.config.*',
  '.eslintrc',
  '.eslintrc.*',
  'tsconfig.json',
  'tsconfig.*.json',
  '.prettierrc',
  '.prettierrc.*',
  'prettier.config.*',
  'stryker.conf.*',
  'stryker.config.*',
  '.github/CODEOWNERS',
  '.github/workflows/protected-change.yml',
]);

export function checkPathsFromConfig(config) {
  const listed = config?.protect?.checkPaths;
  if (Array.isArray(listed) && listed.length) return listed.map(String);
  return [...DEFAULT_CHECK_PATHS];
}

export function pathIsProtected(rel, patterns = DEFAULT_CHECK_PATHS) {
  const file = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  return patterns.some((pattern) => minimatchLike(file, pattern) || file === pattern);
}
