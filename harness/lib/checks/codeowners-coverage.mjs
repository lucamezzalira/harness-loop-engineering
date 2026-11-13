import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.mjs';
import { broadOverrides, readCodeowners, uncoveredGlobs } from './codeowners.mjs';

export function evaluateCodeownersCoverage(root) {
  const config = loadConfig(root);
  const lines = readCodeowners(root);
  return { uncovered: uncoveredGlobs(config, lines), overrides: broadOverrides(lines) };
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const root = process.env.HARNESS_ROOT || process.cwd();
  try {
    const result = evaluateCodeownersCoverage(root);
    if (result.uncovered.length || result.overrides.length) {
      for (const glob of result.uncovered) {
        console.error(`codeowners-coverage: ${glob} has no owner`);
      }
      for (const hit of result.overrides) {
        console.error(
          `codeowners-coverage: ${hit.later} comes after ${hit.earlier} and overrides it`,
        );
      }
      process.exit(1);
    }
    console.log('codeowners-coverage ok');
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(err.exitCode || 2);
  }
}
