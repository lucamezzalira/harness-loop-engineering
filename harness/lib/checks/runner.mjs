import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeTreeHash } from '../tree-hash.mjs';
import { writeReport } from '../report.mjs';
import { loadSensors, wrapWithGuidance } from './common.mjs';

const TIER_RANK = { edit: 0, turn: 1, commit: 2, manual: 99 };

/**
 * @param {string} root
 * @param {object} config
 * @param {{ tier: string, files?: string[], failFast?: boolean }} opts
 */
export async function runChecks(root, config, opts) {
  const started = Date.now();
  const sensors = loadSensors(root).filter((s) => s.enabled !== false);
  const targetRank = TIER_RANK[opts.tier];
  if (targetRank == null) {
    const err = new Error(`Unknown tier "${opts.tier}"`);
    err.exitCode = 2;
    throw err;
  }

  const toRun = sensors.filter((s) => {
    const r = TIER_RANK[s.tier];
    if (s.tier === 'manual') return opts.tier === 'manual';
    return r <= targetRank;
  });

  const results = [];
  let overall = 'pass';
  let harnessBroken = false;

  for (const sensor of toRun) {
    const checkStarted = Date.now();
    let result;
    try {
      const modPath = path.join(root, 'harness', 'sensors', 'checks', `${sensor.name}.mjs`);
      if (!fs.existsSync(modPath)) {
        result = {
          name: sensor.name,
          status: 'skipped',
          reason: `check module missing: harness/sensors/checks/${sensor.name}.mjs`,
        };
      } else {
        const mod = await import(pathToFileURL(modPath).href);
        result = await mod.run({ root, config, files: opts.files, sensor });
      }
    } catch (e) {
      result = {
        name: sensor.name,
        status: 'fail',
        exitCode: 1,
        output: String(e.stack || e.message || e),
      };
    }

    result.name = sensor.name;
    result.durationMs = Date.now() - checkStarted;

    if (result.status === 'fail' && sensor.blocking) {
      result.output = wrapWithGuidance(root, sensor.name, result.output || result.reason || '');
      overall = 'fail';
    } else if (result.status === 'fail' && !sensor.blocking) {
      result.status = result.status === 'fail' ? 'warn' : result.status;
      if (overall === 'pass') overall = 'warn';
    }

    if (result.status === 'harness-error' || result.exitCode === 2) {
      harnessBroken = true;
      overall = 'fail';
    }

    results.push(result);

    if (harnessBroken) break;
    if ((opts.failFast ?? config.verify?.failFast) && overall === 'fail' && sensor.blocking) {
      break;
    }
  }

  const report = {
    tier: opts.tier,
    status: harnessBroken ? 'harness-error' : overall === 'warn' ? 'pass' : overall,
    advisory: overall === 'warn',
    treeHash: computeTreeHash(root),
    durationMs: Date.now() - started,
    checks: results,
  };

  // Advisory-only fails must not block: status pass with advisory flag when only warns
  if (!harnessBroken) {
    const blockingFail = results.some((r) => {
      const sensor = toRun.find((s) => s.name === r.name);
      return sensor?.blocking && (r.status === 'fail' || r.status === 'harness-error');
    });
    report.status = blockingFail ? 'fail' : 'pass';
  }

  writeReport(root, report);
  return report;
}

export function reportExitCode(report) {
  if (report.status === 'harness-error') return 2;
  if (report.checks?.some((c) => c.exitCode === 2 || c.status === 'harness-error')) return 2;
  if (report.status === 'fail') return 1;
  return 0;
}
