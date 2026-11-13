import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.mjs';
import { readCodeowners, uncoveredGlobs } from './codeowners.mjs';

export function evaluateCodeownersCoverage(root) {
  const config = loadConfig(root);
  return uncoveredGlobs(config, readCodeowners(root));
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const root = process.env.HARNESS_ROOT || process.cwd();
  try {
    const missing = evaluateCodeownersCoverage(root);
    if (missing.length) {
      for (const glob of missing) {
        console.error(`codeowners-coverage: ${glob} has no owner`);
      }
      process.exit(1);
    }
    console.log('codeowners-coverage ok');
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(err.exitCode || 2);
  }
}
