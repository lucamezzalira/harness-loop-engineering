import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeTreeHash } from '../tree-hash.mjs';
import { writeReport } from '../report.mjs';
import { loadSensors, wrapWithGuidance, changedFiles } from './common.mjs';

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

  const filesForEdit =
    opts.tier === 'edit'
      ? opts.files?.length
        ? opts.files
        : changedFiles(root)
      : [];

  const envBase = {
    ...process.env,
    HARNESS_ROOT: root,
    HARNESS_TIER: opts.tier,
    HARNESS_CHANGED_FILES: filesForEdit.join('\n'),
    HARNESS_CONFIG_JSON: JSON.stringify(config),
    HARNESS_BASELINE_JSON: JSON.stringify(config.baseline || {}),
  };

  const results = [];
  let overall = 'pass';
  let harnessBroken = false;
  let hasWarnings = false;

  for (const sensor of toRun) {
    const checkStarted = Date.now();
    const scriptPath = path.join(root, 'harness', 'sensors', 'checks', `${sensor.name}.sh`);
    let result;

    if (!fs.existsSync(scriptPath)) {
      result = {
        name: sensor.name,
        status: 'harness-error',
        exitCode: 2,
        reason: `check script missing: harness/sensors/checks/${sensor.name}.sh`,
        output: `check script missing: harness/sensors/checks/${sensor.name}.sh`,
      };
      harnessBroken = true;
      overall = 'fail';
    } else {
      const res = spawnSync('bash', [scriptPath], {
        cwd: root,
        env: envBase,
        encoding: 'utf8',
        timeout: 600_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const code = res.status ?? (res.error ? 2 : 1);
      const stderr = (res.stderr || '').trim();
      const stdout = (res.stdout || '').trim();
      const combined = [stdout, stderr].filter(Boolean).join('\n');

      if (code === 0) {
        result = { name: sensor.name, status: 'pass', exitCode: 0, output: combined || 'ok' };
      } else if (code === 3) {
        result = mapMissing(sensor, stderr || stdout || 'tool not installed');
        if (result.status === 'harness-error') {
          harnessBroken = true;
          overall = 'fail';
        } else if (result.status === 'warn') {
          hasWarnings = true;
          if (overall === 'pass') overall = 'warn';
        }
      } else if (code === 2) {
        result = {
          name: sensor.name,
          status: 'harness-error',
          exitCode: 2,
          reason: combined || 'check broken',
          output: combined || 'check broken',
        };
        harnessBroken = true;
        overall = 'fail';
      } else {
        // exit 1 (or other): code under test is wrong
        if (sensor.blocking) {
          result = {
            name: sensor.name,
            status: 'fail',
            exitCode: 1,
            output: wrapWithGuidance(root, sensor.name, combined || 'failed'),
          };
          overall = 'fail';
        } else {
          result = {
            name: sensor.name,
            status: 'warn',
            exitCode: 1,
            output: combined || 'failed',
          };
          hasWarnings = true;
          if (overall === 'pass') overall = 'warn';
        }
      }
    }

    result.name = sensor.name;
    result.durationMs = Date.now() - checkStarted;
    results.push(result);

    if (harnessBroken) break;
    if ((opts.failFast ?? config.verify?.failFast) && overall === 'fail' && sensor.blocking) {
      break;
    }
  }

  const report = {
    tier: opts.tier,
    status: harnessBroken ? 'harness-error' : 'pass',
    hasWarnings: hasWarnings || results.some((r) => r.status === 'warn'),
    treeHash: computeTreeHash(root),
    durationMs: Date.now() - started,
    checks: results,
  };

  if (!harnessBroken) {
    const blockingFail = results.some((r) => r.status === 'fail' || r.status === 'harness-error');
    report.status = blockingFail ? 'fail' : 'pass';
  }

  writeReport(root, report);
  return report;
}

/**
 * Exit 3 from a check: tool absent. Registry decides meaning.
 */
function mapMissing(sensor, reason) {
  const policy = sensor.missing;
  if (policy === 'exit2') {
    return {
      name: sensor.name,
      status: 'harness-error',
      exitCode: 2,
      reason,
      output: reason,
    };
  }
  if (policy === 'warn') {
    return { name: sensor.name, status: 'warn', reason, output: reason };
  }
  // skip or n/a
  return { name: sensor.name, status: 'skipped', reason, output: reason };
}

export function reportExitCode(report) {
  if (report.status === 'harness-error') return 2;
  if (report.checks?.some((c) => c.exitCode === 2 || c.status === 'harness-error')) return 2;
  if (report.status === 'fail') return 1;
  return 0;
}
