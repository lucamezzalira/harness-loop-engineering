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
import { invokeRole, loadRoleFile, probeProvider } from '../agents/invoke.mjs';
import { stopSequence, preCommitGate } from '../enforce/stop.mjs';
import { runChecks, reportExitCode } from '../checks/runner.mjs';
import { runPanel } from '../panel/dispatch.mjs';
import { expireBacklog, renderBacklog } from '../panel/backlog.mjs';
import { appendHandoff } from './handoff.mjs';
import { maybeSplitUnit } from './plan.mjs';
import { readSession, writeSession, recordUsage, renderReport } from '../accounting.mjs';
import { computeTreeHash } from '../tree-hash.mjs';
import { newSessionId } from '../log.mjs';

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
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

  let session = readSession(root);
  if (!resume || !session) {
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

  if (resume && config.loop?.confirmOnTreeDrift !== false) {
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

  try {
    for (const wave of plan.waves || []) {
      if (fs.existsSync(path.join(root, 'harness', 'state', 'STOP'))) {
        session.stopReason = 'STOP file';
        break;
      }

      const parallel = wave.length > 1;
      if (parallel) {
        // worktrees for genuinely parallel units
        const results = [];
        for (const id of wave) {
          results.push(await runUnitInWorktree(root, config, plan, session, id));
        }
        // merge worktrees
        const mergeOk = mergeWorktrees(root, wave, session);
        if (!mergeOk.ok) {
          for (const id of wave) session.unitStatus[id] = 'incomplete';
          // re-invoke planner to sequence
          console.error('Wave merge failed; units marked incomplete. Re-run --plan to sequence.');
          session.stopReason = 'merge-conflict';
          writeSession(root, session);
          break;
        }
        // post-wave turn tier on merged result
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

    // Full panel at end of units
    await runPanel(root, config, { cadence: 'unit', unitComplete: true });

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
  if (session.unitStatus[unitId] === 'complete') return null;

  let unitTurns = 0;
  const shared = session.sharedDecisions || [];

  while (true) {
    if (fs.existsSync(path.join(root, 'harness', 'state', 'STOP'))) {
      session.stopReason = 'STOP file';
      return { exitCode: 0, message: 'stopped by STOP file', session };
    }
    if (session.turns >= budgets.maxTurns) {
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

    // Implementer turn via host tool / API
    const binding = resolveRoleBinding(config, 'planner'); // use balanced implementer: prefer reviewer tier as stand-in
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

    // stop sequence
    const stop = await stopSequence(root, config, {
      sessionId: session.id,
      unitId,
      cadence: 'turn',
      unitComplete: false,
    });
    if (!stop.allow) {
      // identical failure brake
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
      continue; // retry inside same turn budget? PRD: verify retries inside a turn
    }

    session.lastFailFingerprint = null;
    session.identicalFailCount = 0;

    // Unit-end panel when gate says each-unit and unit looks done
    const done = await unitLooksComplete(root, unit);
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

      // Commit gate asks (interactive) but never auto-commits
      const gate = preCommitGate(root, { agentInitiated: true, explicitInstruction: false });
      console.error(`Commit gate (unit ${unitId}): ${gate.reason}`);
      spawnSync('git', ['add', '-A'], { cwd: root });
      session.unitStatus[unitId] = 'complete';
      await maybeSplitUnit(root, config, unit, unitTurns);
      writeSession(root, session);
      return null;
    }

    // continue turns until done or budgets
  }
}

async function runUnitInWorktree(root, config, plan, session, unitId) {
  const wt = path.join(root, 'worktrees', unitId);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  if (!fs.existsSync(wt)) {
    spawnSync('git', ['worktree', 'add', wt, 'HEAD'], { cwd: root, encoding: 'utf8' });
  }
  // Run unit logic inside worktree by temporarily treating it as root for checks
  // For simplicity: run implementer against worktree path
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
    // checkout files from worktree via git diff and apply is complex;
    // use git merge with worktree branch if created; fallback: copy tracked diffs
    const status = spawnSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' });
    if (status.stdout?.trim()) {
      // add and commit in worktree is forbidden; instead sync files
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
      // untracked files
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

async function unitLooksComplete(root, unit) {
  // Heuristic: all acceptance ids for unit either pass or still false but tests exist
  // Prefer explicit marker in plan state
  const slugDirs = fs.existsSync(path.join(root, 'specs'))
    ? fs.readdirSync(path.join(root, 'specs'))
    : [];
  for (const slug of slugDirs) {
    const acc = path.join(root, 'specs', slug, 'acceptance.json');
    if (!fs.existsSync(acc)) continue;
    const entries = JSON.parse(fs.readFileSync(acc, 'utf8'));
    const list = Array.isArray(entries) ? entries : entries.entries || [];
    const mine = list.filter((e) => (unit.acceptance || []).includes(e.id));
    if (mine.length && mine.every((e) => e.passes)) return true;
  }
  // Fallback: after at least 1 successful stop with no blocking, mark complete when estimatedTurns reached
  return false;
}

export async function runResume(root, config) {
  return runLoop(root, config, { resume: true });
}
