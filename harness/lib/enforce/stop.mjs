import fs from 'node:fs';
import path from 'node:path';
import { runChecks, reportExitCode } from '../checks/runner.mjs';
import { runPanel } from '../panel/dispatch.mjs';
import { computeTreeHash } from '../tree-hash.mjs';
import { appendHandoff } from '../plan/handoff.mjs';
import { readSession, writeSession } from '../accounting.mjs';

/**
 * Stop sequence (identical whether or not --loop is driving):
 * 1. turn tier; red → block (retry); 3rd attempt escalate
 * 2. green + tree hash changed → panel
 * 3. P0/P1 under cycle cap → inject table, block
 * 4. else allow, record reviewed hash
 * 5. append HANDOFF.md
 */
export async function stopSequence(root, config, opts = {}) {
  const stateDir = path.join(root, 'harness', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const session = readSession(root) || {
    id: opts.sessionId || 'adhoc',
    verifyRetries: 0,
    panelCycles: 0,
    lastReviewedHash: null,
    lastFailFingerprint: null,
  };

  // 1. turn tier
  const report = await runChecks(root, config, { tier: 'turn', failFast: config.verify?.failFast });
  const code = reportExitCode(report);
  if (code === 2) {
    return { allow: false, exitCode: 2, reason: 'harness-error', report };
  }
  if (code === 1) {
    session.verifyRetries = (session.verifyRetries || 0) + 1;
    writeSession(root, session);
    const max = config.verify?.maxStopRetries ?? 2;
    if (session.verifyRetries > max) {
      const failing = report.checks?.filter((c) => c.status === 'fail').map((c) => c.name);
      const msg = [
        'ESCALATION FOR HUMAN',
        `Check(s) will not go green after ${session.verifyRetries} verify retries: ${failing?.join(', ')}`,
        'Stop allowed so a human can intervene. Tree left intact.',
      ].join('\n');
      appendHandoff(root, { title: 'Escalation', body: msg });
      return { allow: true, exitCode: 1, reason: 'verify-escalation', report, message: msg };
    }
    return {
      allow: false,
      exitCode: 1,
      reason: 'verify-fail',
      report,
      message: `Turn tier failed (retry ${session.verifyRetries}/${max}). Fix and stop again.`,
    };
  }

  session.verifyRetries = 0;

  // 2. panel if tree changed
  const treeHash = report.treeHash || computeTreeHash(root);
  let panel = null;
  if (treeHash !== session.lastReviewedHash) {
    if (config.review?.requireGreen !== false) {
      panel = await runPanel(root, config, {
        cadence: opts.cadence || 'turn',
        sinceHash: session.lastReviewedHash,
        unitId: opts.unitId,
        cycle: (session.panelCycles || 0) + 1,
        unitComplete: opts.unitComplete,
        acceptanceChanged: opts.acceptanceChanged,
      });
    }
  }

  if (panel?.blocking?.length) {
    session.panelCycles = (session.panelCycles || 0) + 1;
    writeSession(root, session);
    const maxCycles = config.review?.maxCycles ?? 3;
    if (session.panelCycles <= maxCycles) {
      return {
        allow: false,
        exitCode: 1,
        reason: 'panel-blocking',
        report,
        panel,
        message: panel.table,
      };
    }
    // escalate with leftovers
    appendHandoff(root, {
      title: 'Panel cycle cap',
      body: `Reached review.maxCycles=${maxCycles}. Remaining blocking findings surfaced:\n${panel.table}`,
    });
  }

  session.lastReviewedHash = treeHash;
  session.panelCycles = 0;
  writeSession(root, session);

  appendHandoff(root, {
    title: opts.handoffTitle || 'Stop',
    body: opts.handoffBody || `Stop allowed. treeHash=${treeHash}`,
  });

  return { allow: true, exitCode: 0, reason: 'ok', report, panel };
}

/**
 * Pre-commit: report.json treeHash must match and status pass.
 * Also enforces ship gate for agent-initiated commits.
 */
export function preCommitGate(root, opts = {}) {
  const reportPath = path.join(root, 'harness', 'state', 'report.json');
  if (!fs.existsSync(reportPath)) {
    return { allow: false, reason: 'no report.json — run ./verify.sh first' };
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const current = computeTreeHash(root);
  if (report.treeHash !== current) {
    return {
      allow: false,
      reason: `treeHash drift: report ${report.treeHash} vs tree ${current}. Re-run ./verify.sh`,
    };
  }
  if (report.status !== 'pass') {
    return { allow: false, reason: `report status is ${report.status}, not pass` };
  }

  // Ship gate: agent-initiated commit refused regardless of check status
  if (opts.agentInitiated && !opts.explicitInstruction) {
    return {
      allow: false,
      reason:
        'ship gate: agent-initiated commit refused. Passing checks earn the right to be offered, never the right to land. Need an explicit developer instruction in this session.',
    };
  }

  // Bypass
  if (process.env.HARNESS_BYPASS) {
    const reason = process.env.HARNESS_BYPASS;
    if (!reason.trim()) {
      return { allow: false, reason: 'HARNESS_BYPASS set but empty — provide a non-empty reason' };
    }
    const log = path.join(root, 'harness', 'state', 'bypass.log');
    fs.appendFileSync(log, `${new Date().toISOString()} ${reason}\n`);
    return {
      allow: true,
      reason: `bypass: ${reason}`,
      trailer: `Harness-Bypass: ${reason}`,
    };
  }

  return { allow: true, reason: 'pre-commit ok' };
}
