import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertLoopConfig,
  formatAssignmentBlock,
  requireTool,
  resolveRoleBinding,
} from '../config.mjs';
import { confirmProfile } from '../tty.mjs';
import { invokeRole } from '../agents/invoke.mjs';
import { stopSequence, preCommitGate } from '../enforce/stop.mjs';
import { runChecks, reportExitCode } from '../checks/runner.mjs';
import { runPanel } from '../panel/dispatch.mjs';
import { expireBacklog, renderBacklog } from '../panel/backlog.mjs';
import { appendHandoff } from './handoff.mjs';
import { maybeSplitUnit } from './plan.mjs';
import { normalizeAcceptanceId } from './acceptance-id.mjs';
import { normalizePlanAcceptance, validatePlan } from './validate-plan.mjs';
import { readSession, writeSession, recordUsage, renderReport } from '../accounting.mjs';
import { computeTreeHash } from '../tree-hash.mjs';
import { newSessionId } from '../log.mjs';
import { minimatchLike } from '../util/glob.mjs';

const TERMINAL_UNIT_STATUS = new Set(['complete', 'unclosable']);

export function isTerminalUnitStatus(status) {
  return TERMINAL_UNIT_STATUS.has(status);
}

/**
 * True when an existing session still has unfinished plan units,
 * or when ship-panel-blocking left work to re-review.
 */
export function shouldResumeLoop(plan, session) {
  if (!session || !plan?.units?.length) return false;
  if (session.stopReason === 'complete') return false;
  if (session.stopReason === 'ship-panel-blocking') return true;
  const status = session.unitStatus || {};
  return plan.units.some((u) => !isTerminalUnitStatus(status[u.id]));
}

/**
 * --loop: confirmation, wave by wave, unit by unit.
 * Ends with work staged and not committed (ship gate).
 */
export async function runLoop(root, config, { resume = false } = {}) {
  requireTool(config);
  assertLoopConfig(config);

  const planPath = path.join(root, 'harness', 'state', 'plan.json');
  if (!fs.existsSync(planPath)) {
    const err = new Error('No plan.json. Run ./verify.sh --plan first.');
    err.exitCode = 2;
    throw err;
  }
  let plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  plan = normalizePlanAcceptance(plan);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  const planCheck = validatePlan(root, plan, {
    prdSlug: path.basename(path.dirname(path.join(root, config.loop.prd))),
  });
  if (!planCheck.ok) {
    const err = new Error(
      `Plan validation failed (fix plan.json or re-run ./verify.sh --plan):\n${planCheck.errors
        .map((e) => `  - ${e}`)
        .join('\n')}`,
    );
    err.exitCode = 1;
    throw err;
  }

  let session = readSession(root);
  const wantResume = resume
    ? Boolean(session) && shouldResumeLoop(plan, session)
    : false;

  if (!wantResume || !session) {
    session = {
      id: newSessionId(),
      prd: config.loop.prd,
      prdSlug: path.basename(path.dirname(path.join(root, config.loop.prd))),
      startedAt: new Date().toISOString(),
      turns: 0,
      roles: {},
      units: {},
      panelCycles: {},
      unitStatus: {},
      stopReason: null,
      sharedDecisions: [...(plan.sharedDecisions || [])],
      lastFailFingerprint: null,
    };
  }

  if (wantResume && config.loop?.confirmOnTreeDrift !== false) {
    const saved = session.treeHashAtPause;
    const now = computeTreeHash(root);
    if (saved && saved !== now) {
      console.error(`Tree drifted since pause: ${saved} → ${now}`);
      if (process.stdin.isTTY) {
        const { confirmProfile: confirm } = await import('../tty.mjs');
        const ans = await confirm(`Resume onto changed tree?`);
        if (!ans.confirmed) {
          return { exitCode: 0, message: 'Resume cancelled (tree drift).' };
        }
      } else {
        console.error(
          'non-TTY: tree drift noted; proceeding per confirmOnTreeDrift default after log',
        );
      }
    }
  }

  // Confirmation
  const block = formatAssignmentBlock(config);
  if (config.confirmProfile !== false && config.loop?.gate !== 'never') {
    const conf = await confirmProfile(block);
    if (!conf.confirmed) return { exitCode: 0, message: 'Loop cancelled.' };
    if (conf.skipped) console.error('non-TTY: profile confirmation skipped\n' + block);
  }

  writeSession(root, session);
  const started = Date.now();
  const maxTurns = config.loop.maxTurns;
  const maxSeconds = config.loop.maxSeconds ?? 1800;
  const maxCost = config.loop.maxCostUsd ?? 5;
  const unitIds = (plan.units || []).map((u) => u.id);

  try {
    // After ship-panel-blocking, every unit is terminal; skip waves and re-run ship.
    const allUnitsComplete =
      unitIds.length > 0 &&
      unitIds.every((id) => isTerminalUnitStatus(session.unitStatus[id]));
    if (allUnitsComplete) {
      console.error('All units complete; skipping wave panels and running ship panel.');
    }

    for (const wave of plan.waves || []) {
      if (allUnitsComplete) break;
      if (fs.existsSync(path.join(root, 'harness', 'state', 'STOP'))) {
        session.stopReason = 'STOP file';
        break;
      }

      const parallel = wave.length > 1;
      if (parallel) {
        if (wave.every((id) => isTerminalUnitStatus(session.unitStatus[id]))) {
          continue;
        }
        const results = [];
        for (const id of wave) {
          if (isTerminalUnitStatus(session.unitStatus[id])) continue;
          results.push(await runUnitInWorktree(root, config, plan, session, id));
        }
        const mergeOk = mergeWorktrees(root, wave, session);
        if (!mergeOk.ok) {
          for (const id of wave) session.unitStatus[id] = 'incomplete';
          console.error('Wave merge failed; units marked incomplete. Re-run --plan to sequence.');
          session.stopReason = 'merge-conflict';
          writeSession(root, session);
          break;
        }
        const report = await runChecks(root, config, { tier: 'turn' });
        if (reportExitCode(report) !== 0) {
          session.stopReason = 'post-wave-verify-fail';
          writeSession(root, session);
          return {
            exitCode: 1,
            message: 'Post-wave turn tier failed on merged result.',
            report,
          };
        }
      } else {
        for (const id of wave) {
          const stop = await runUnit(root, config, plan, session, id, {
            maxTurns,
            maxSeconds,
            maxCost,
            started,
          });
          if (stop) {
            writeSession(root, session);
            return stop;
          }
        }
      }
    }

    // Ship panel: full specialist coverage before staging
    const shipCadence = config.review?.cadence?.ship ? 'ship' : 'unit';
    const panel = await runPanel(root, config, {
      cadence: shipCadence,
      unitComplete: true,
    });
    if (panel.blocking?.length) {
      session.stopReason = 'ship-panel-blocking';
      writeSession(root, session);
      appendHandoff(root, {
        title: 'Ship panel blocking',
        body: `Ship panel blocked (${panel.blocking.length} finding(s)). See harness/state/review.md, then ./verify.sh --loop.`,
      });
      console.log(panel.table || '');
      return {
        exitCode: 1,
        message: `Ship panel blocked (${panel.blocking.length} finding(s)). See harness/state/review.md, then ./verify.sh --loop.`,
        session,
      };
    }

    // Stage everything; do not commit
    spawnSync('git', ['add', '-A'], { cwd: root });
    const gate = preCommitGate(root, { agentInitiated: true, explicitInstruction: false });
    session.stopReason = session.stopReason || 'complete';
    session.treeHashAtPause = computeTreeHash(root);
    writeSession(root, session);

    expireBacklog(root, config);
    const backlog = renderBacklog(root);
    appendHandoff(root, {
      title: 'Session complete',
      body: `Work staged, not committed (ship gate).\nPre-commit: ${gate.reason}\n\n${backlog}`,
    });

    console.log(renderReport(root));
    console.log(backlog);
    console.log(
      'Loop finished. Changes are staged and uncommitted. Commit only with an explicit developer instruction.',
    );
    return { exitCode: 0, message: 'complete', session };
  } catch (e) {
    session.stopReason = `error: ${e.message}`;
    writeSession(root, session);
    appendHandoff(root, { title: 'Loop error', body: String(e.stack || e) });
    throw e;
  }
}

async function runUnit(root, config, plan, session, unitId, budgets) {
  const unit = (plan.units || []).find((u) => u.id === unitId);
  if (!unit) return null;
  if (isTerminalUnitStatus(session.unitStatus[unitId])) return null;

  let unitTurns = 0;
  const shared = session.sharedDecisions || [];

  while (true) {
    if (fs.existsSync(path.join(root, 'harness', 'state', 'STOP'))) {
      session.stopReason = 'STOP file';
      return { exitCode: 0, message: 'stopped by STOP file', session };
    }
    if (budgets.maxTurns != null && session.turns >= budgets.maxTurns) {
      session.stopReason = `maxTurns: ${budgets.maxTurns}`;
      return { exitCode: 0, message: session.stopReason, session };
    }
    if ((Date.now() - budgets.started) / 1000 > budgets.maxSeconds) {
      session.stopReason = `maxSeconds: ${budgets.maxSeconds}`;
      return { exitCode: 0, message: session.stopReason, session };
    }
    const cost = Object.values(session.roles || {}).reduce((s, r) => s + (r.cost || 0), 0);
    if (cost > budgets.maxCost) {
      session.stopReason = `maxCostUsd: ${budgets.maxCost}`;
      return { exitCode: 0, message: session.stopReason, session };
    }

    const binding = resolveRoleBinding(config, 'planner');
    const implBinding = resolveRoleBinding(config, 'test-writer') || binding;
    const roleMd = `You are the implementer for unit ${unit.id}: ${unit.title}.\nTouches: ${(unit.touches || []).join(', ')}\nAcceptance: ${(unit.acceptance || []).join(', ')}\nShared decisions:\n${shared.map((d) => `- ${d}`).join('\n')}\nImplement the smallest change. Do not commit, push, PR, or deploy.`;
    const result = await invokeRole({
      root,
      config,
      binding: { ...implBinding, role: 'implementer' },
      systemPrompt: roleMd,
      userPrompt: `Continue unit ${unit.id}. Read HANDOFF.md and the PRD. Make progress.`,
      expect: 'text',
    });
    recordUsage(root, { role: 'implementer', unitId, usage: result.usage });
    session.turns += 1;
    unitTurns += 1;
    writeSession(root, session);

    const stop = await stopSequence(root, config, {
      sessionId: session.id,
      unitId,
      cadence: 'turn',
      unitComplete: false,
    });
    if (!stop.allow) {
      const fp = `${stop.reason}:${stop.report?.treeHash}`;
      if (session.lastFailFingerprint === fp && config.loop.stopOnIdenticalFailures) {
        const count = (session.identicalFailCount || 0) + 1;
        session.identicalFailCount = count;
        if (count >= config.loop.stopOnIdenticalFailures) {
          session.stopReason = `stopOnIdenticalFailures: ${stop.reason}`;
          return { exitCode: 0, message: session.stopReason, session };
        }
      } else {
        session.identicalFailCount = 1;
        session.lastFailFingerprint = fp;
      }
      writeSession(root, session);
      continue;
    }

    session.lastFailFingerprint = null;
    session.identicalFailCount = 0;

    const done = unitLooksComplete(root, unit, { unitTurns });
    if (done) {
      const panel = await runPanel(root, config, {
        cadence: 'unit',
        unitId,
        unitComplete: true,
      });
      session.panelCycles[unitId] = (session.panelCycles[unitId] || 0) + 1;
      if (
        panel.blocking?.length &&
        session.panelCycles[unitId] <= (config.review?.maxCycles || 3)
      ) {
        writeSession(root, session);
        continue;
      }

      const gate = preCommitGate(root, { agentInitiated: true, explicitInstruction: false });
      console.error(`Commit gate (unit ${unitId}): ${gate.reason}`);
      spawnSync('git', ['add', '-A'], { cwd: root });
      session.unitStatus[unitId] = 'complete';
      await maybeSplitUnit(root, config, unit, unitTurns);
      writeSession(root, session);
      return null;
    }

    if (shouldStallUnit(root, unit, unitTurns, config)) {
      return leaveUnitUnclosable(root, session, unit, unitTurns, {
        reason: stallReason(root, unit, unitTurns, config),
      });
    }
  }
}

async function runUnitInWorktree(root, config, plan, session, unitId) {
  const wt = path.join(root, 'worktrees', unitId);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  if (!fs.existsSync(wt)) {
    spawnSync('git', ['worktree', 'add', wt, 'HEAD'], { cwd: root, encoding: 'utf8' });
  }
  const unit = (plan.units || []).find((u) => u.id === unitId);
  const binding = resolveRoleBinding(config, 'test-writer');
  await invokeRole({
    root: wt,
    config,
    binding: { ...binding, role: 'implementer' },
    systemPrompt: `Implement unit ${unitId} in this worktree only. ${unit?.title}`,
    userPrompt: 'Make progress on this unit. Do not commit.',
    expect: 'text',
  });
  session.unitStatus[unitId] = 'worktree-done';
  return { unitId, wt };
}

function mergeWorktrees(root, wave, session) {
  for (const id of wave) {
    const wt = path.join(root, 'worktrees', id);
    if (!fs.existsSync(wt)) continue;
    const status = spawnSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' });
    if (status.stdout?.trim()) {
      const diff = spawnSync('git', ['-C', wt, 'diff'], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      if (diff.stdout) {
        const apply = spawnSync('git', ['apply', '--whitespace=nowarn'], {
          cwd: root,
          input: diff.stdout,
          encoding: 'utf8',
        });
        if (apply.status !== 0) {
          return { ok: false, conflict: apply.stderr || apply.stdout, unitId: id };
        }
      }
      const untracked = spawnSync('git', ['-C', wt, 'ls-files', '--others', '--exclude-standard'], {
        encoding: 'utf8',
      });
      for (const rel of (untracked.stdout || '').split('\n').filter(Boolean)) {
        const src = path.join(wt, rel);
        const dest = path.join(root, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }
  }
  return { ok: true };
}

/**
 * Whether a unit looks done enough to leave the serial turn loop.
 * Linked acceptance tests that all pass win. Stub units (test: null) do not
 * wait on deploy-level A-* passes; they complete when estimatedTurns is met
 * and touch paths have local file or git evidence.
 */
export function unitLooksComplete(root, unit, { unitTurns = 0 } = {}) {
  const mine = loadUnitAcceptance(root, unit);

  const withTests = mine.filter((e) => e.test != null && e.test !== '');
  if (withTests.length > 0 && withTests.every((e) => e.passes)) return true;

  if (mine.length > 0 && mine.every((e) => e.passes)) return true;

  const estimated = Number(unit?.estimatedTurns) || 0;
  if (
    estimated > 0 &&
    unitTurns >= estimated &&
    touchPathsHaveEvidence(root, unit?.touches || [])
  ) {
    return true;
  }
  return false;
}

/** Turn ceiling before a unit is left as unclosable. */
export function unitStallLimit(unit, config = {}) {
  const estimated = Math.max(1, Number(unit?.estimatedTurns) || 3);
  const factor = Number(config?.loop?.unitStallFactor ?? 2);
  const grace = Number(config?.loop?.unitStallGraceTurns ?? 0);
  return Math.max(estimated + grace, Math.ceil(estimated * factor));
}

/**
 * True when the unit has burned enough turns without becoming complete.
 * Fast-path: at/after estimatedTurns with zero touch evidence.
 */
export function shouldStallUnit(root, unit, unitTurns, config = {}) {
  const estimated = Math.max(1, Number(unit?.estimatedTurns) || 3);
  if (unitTurns < estimated) return false;
  if (unitLooksComplete(root, unit, { unitTurns })) return false;
  if (!touchPathsHaveEvidence(root, unit?.touches || [])) return true;
  return unitTurns >= unitStallLimit(unit, config);
}

export function stallReason(root, unit, unitTurns, config = {}) {
  const estimated = Math.max(1, Number(unit?.estimatedTurns) || 3);
  if (!touchPathsHaveEvidence(root, unit?.touches || [])) {
    return `no touch evidence after ${unitTurns} turn(s) (estimated ${estimated}; touches: ${(unit?.touches || []).join(', ') || '(none)'})`;
  }
  return `still incomplete after ${unitTurns} turn(s) (stall limit ${unitStallLimit(unit, config)})`;
}

function leaveUnitUnclosable(root, session, unit, unitTurns, { reason }) {
  const unitId = unit.id;
  session.unitStatus[unitId] = 'unclosable';
  session.stopReason = null;
  appendHandoff(root, {
    title: 'ESCALATION FOR HUMAN',
    body: [
      `Unit ${unitId} left unclosable: ${reason}.`,
      'Fix plan touches/acceptance or the implementation, then ./verify.sh --loop.',
      `Unit turns this attempt: ${unitTurns}.`,
    ].join('\n'),
  });
  writeSession(root, session);
  console.error(`Unit ${unitId} unclosable — ${reason}`);
  return null;
}

function loadUnitAcceptance(root, unit) {
  const ids = (unit?.acceptance || []).map(normalizeAcceptanceId).filter(Boolean);
  if (!ids.length) return [];
  const want = new Set(ids);
  const slugDirs = fs.existsSync(path.join(root, 'specs'))
    ? fs.readdirSync(path.join(root, 'specs'))
    : [];
  const mine = [];
  for (const slug of slugDirs) {
    const acc = path.join(root, 'specs', slug, 'acceptance.json');
    if (!fs.existsSync(acc)) continue;
    const entries = JSON.parse(fs.readFileSync(acc, 'utf8'));
    const list = Array.isArray(entries) ? entries : entries.entries || [];
    for (const e of list) {
      const eid = normalizeAcceptanceId(e.id);
      if (want.has(eid)) mine.push(e);
    }
  }
  return mine;
}

/** Match a repo-relative path against a unit touch glob (supports * and **). */
export function pathMatchesTouch(relPath, touch) {
  const p = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const t = String(touch || '').replace(/\\/g, '/');
  if (!t) return false;
  if (t.endsWith('/**')) {
    const prefix = t.slice(0, -3);
    return p === prefix || p.startsWith(prefix + '/');
  }
  return minimatchLike(p, t);
}

function dirHasNonNoiseFiles(absDir) {
  const stack = [absDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        stack.push(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when touch globs resolve to existing files/dirs, or git status shows
 * changes under those paths (excluding harness/state).
 */
export function touchPathsHaveEvidence(root, touches) {
  if (!touches?.length) return false;
  for (const t of touches) {
    const base = String(t)
      .replace(/\\/g, '/')
      .replace(/\/\*\*$/, '')
      .replace(/\*\*$/, '')
      .replace(/\*$/, '')
      .replace(/\.$/, '');
    if (!base) continue;
    const abs = path.join(root, base);
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    if (st.isFile()) return true;
    if (st.isDirectory() && dirHasNonNoiseFiles(abs)) return true;
  }

  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  });
  for (const line of (status.stdout || '').split('\n').filter(Boolean)) {
    const rel = porcelainPath(line);
    if (isHarnessStateNoise(rel)) continue;
    if (touches.some((t) => pathMatchesTouch(rel, t))) return true;
  }
  return false;
}

/** Paths under harness/state are session noise, not unit work. */
export function isHarnessStateNoise(relPath) {
  const p = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  return p === 'harness/state' || p.startsWith('harness/state/');
}

function porcelainPath(line) {
  let rest = String(line || '').slice(3).trim();
  if (rest.includes(' -> ')) rest = rest.split(' -> ').pop();
  return rest.replace(/^"|"$/g, '');
}

/** Why a parallel-wave unit is finishing serially in the main tree. */
export function serialFallbackReason(id, worktreeOutcome, mergedSet, preWaveStatus) {
  const outcome = worktreeOutcome[id];
  if (outcome === 'invoke-failed') {
    return `Parallel worktree for ${id} invoke failed; continuing serially in main tree.`;
  }
  if (outcome === 'no-changes') {
    return `Parallel worktree for ${id} produced no changes; continuing serially in main tree.`;
  }
  if (outcome === 'worktree-done' || preWaveStatus[id] === 'worktree-done') {
    return `Parallel worktree for ${id} produced no mergeable changes; continuing serially in main tree.`;
  }
  return `Unit ${id} incomplete after parallel wave; continuing serially in main tree.`;
}

/** Turns consumed in the current loop/resume segment (not lifetime session.turns). */
export function segmentTurnCount(session, turnsBase = 0) {
  return Math.max(0, (session?.turns || 0) - (turnsBase || 0));
}

export async function runResume(root, config) {
  return runLoop(root, config, { resume: true });
}
