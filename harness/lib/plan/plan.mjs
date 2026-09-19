import fs from 'node:fs';
import path from 'node:path';
import { resolveRoleBinding, formatAssignmentBlock, requireTool } from '../config.mjs';
import { invokeRole, loadRoleFile, probeProvider } from '../agents/invoke.mjs';
import { confirmProfile, confirmSplit, isTTY } from '../tty.mjs';
import { recordUsage, writeSession, readSession } from '../accounting.mjs';
import { minimatchLike } from '../util/glob.mjs';

/**
 * ./verify.sh --plan
 */
export async function runPlan(root, config) {
  requireTool(config);
  const prd = config.loop?.prd;
  if (!prd) {
    const err = new Error(
      [
        'Missing required setting(s): loop.prd',
        `Found: ${JSON.stringify(config.loop || {})}`,
        'Why: Names the PRD the planner decomposes. Without it --plan has no input.',
        'Paste into harness.yaml:',
        '',
        'loop:',
        '  prd: specs/<slug>/PRD.md',
        '  maxTurns: 20',
        '',
      ].join('\n'),
    );
    err.exitCode = 2;
    throw err;
  }

  const prdPath = path.isAbsolute(prd) ? prd : path.join(root, prd);
  if (!fs.existsSync(prdPath)) {
    const err = new Error(`PRD not found: ${prdPath}`);
    err.exitCode = 2;
    throw err;
  }

  // Confirmation
  const block = formatAssignmentBlock(config);
  const probes = [];
  for (const role of ['planner']) {
    const b = resolveRoleBinding(config, role);
    if (b?.providerMeta?.type === 'openai-compatible') {
      probes.push(await probeProvider(b.providerMeta));
    }
  }
  const probeLine = probes.length ? `\nLocal probe: ${probes.map((p) => p.detail).join('; ')}` : '';
  if (config.confirmProfile !== false && config.loop?.gate !== 'never') {
    const conf = await confirmProfile(block + probeLine);
    if (!conf.confirmed) {
      return { exitCode: 0, message: 'Plan cancelled.' };
    }
    if (conf.skipped) {
      console.error('non-TTY: profile confirmation skipped; resolved assignment:');
      console.error(block);
    }
  } else {
    console.error(block);
  }

  const binding = resolveRoleBinding(config, 'planner');
  const roleMd = loadRoleFile(root, 'planner') || 'You are the planner.';
  const prdText = fs.readFileSync(prdPath, 'utf8');
  const systemPrompt = `${roleMd}\n\nReturn ONLY JSON matching:\n{ "prd": "...", "units": [{"id","title","touches","dependsOn","acceptance","estimatedTurns","contractChange":"none|additive|breaking"}], "waves": [["U1"]], "sharedDecisions": [], "contextRisk": "" }`;
  const userPrompt = `Decompose this PRD into units and waves.\n\n${prdText}`;

  const result = await invokeRole({
    root,
    config,
    binding,
    systemPrompt,
    userPrompt,
    expect: 'json',
  });

  if (!result.ok || !result.data) {
    const err = new Error(result.error || 'planner returned no JSON');
    err.exitCode = 1;
    throw err;
  }

  let plan = result.data;
  plan.prd = plan.prd || prd;
  plan = normalizeWaves(plan);

  // Write acceptance.json stubs
  const slug = path.basename(path.dirname(prdPath));
  const accPath = path.join(root, 'specs', slug, 'acceptance.json');
  fs.mkdirSync(path.dirname(accPath), { recursive: true });
  if (!fs.existsSync(accPath)) {
    const entries = [];
    for (const u of plan.units || []) {
      for (const a of u.acceptance || []) {
        entries.push({ id: a, passes: false, test: null, unit: u.id });
      }
    }
    fs.writeFileSync(accPath, JSON.stringify(entries, null, 2) + '\n');
  }

  const out = path.join(root, 'harness', 'state', 'plan.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(plan, null, 2) + '\n');

  recordUsage(root, { role: 'planner', usage: result.usage });
  const session = readSession(root) || {};
  writeSession(root, {
    ...session,
    id: session.id || Math.random().toString(16).slice(2, 8),
    prd,
    prdSlug: slug,
    planWrittenAt: new Date().toISOString(),
  });

  return {
    exitCode: 0,
    plan,
    path: out,
    message: `Plan written to ${out}. Nothing implemented until --loop.`,
  };
}

/**
 * Overlapping touches are sequenced regardless of planner opinion.
 * Breaking contract changes sequence; additive can parallel.
 */
export function normalizeWaves(plan) {
  const units = plan.units || [];
  const byId = Object.fromEntries(units.map((u) => [u.id, u]));

  // Start from planner waves, then fix overlaps
  let waves = (plan.waves || []).map((w) => [...w]);
  if (!waves.length) waves = [units.map((u) => u.id)];

  const fixed = [];
  for (const wave of waves) {
    const remaining = [...wave];
    while (remaining.length) {
      const batch = [];
      const deferred = [];
      for (const id of remaining) {
        const u = byId[id];
        if (!u) continue;
        const conflict = batch.some((oid) => {
          const o = byId[oid];
          if (touchesOverlap(u.touches, o.touches)) {
            // shared contracts package: allow if both additive
            if (bothOnlyContracts(u, o) && !isBreaking(u) && !isBreaking(o)) return false;
            if (isBreaking(u) || isBreaking(o)) return true;
            return true;
          }
          return false;
        });
        if (conflict) deferred.push(id);
        else batch.push(id);
      }
      if (!batch.length) {
        // force one to progress
        batch.push(remaining.shift());
        fixed.push(batch);
        remaining.splice(0, remaining.length, ...deferred.filter((d) => d !== batch[0]));
      } else {
        fixed.push(batch);
        remaining.splice(0, remaining.length, ...deferred);
      }
    }
  }
  plan.waves = fixed;
  return plan;
}

function touchesOverlap(a = [], b = []) {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      // rough: if one glob could match the other's prefix
      if (minimatchLike(x.replace(/\*\*/g, 'x').replace(/\*/g, 'x'), y)) return true;
      if (minimatchLike(y.replace(/\*\*/g, 'x').replace(/\*/g, 'x'), x)) return true;
      const xs = x.split('/')[0];
      const ys = y.split('/')[0];
      if (xs && xs === ys && xs !== '**') return true;
    }
  }
  return false;
}

function bothOnlyContracts(u, o) {
  const isContracts = (t) => /contracts|packages\//.test(String(t));
  return (u.touches || []).every(isContracts) && (o.touches || []).every(isContracts);
}

function isBreaking(u) {
  return u.contractChange === 'breaking';
}

export async function maybeSplitUnit(root, config, unit, actualTurns) {
  const factor = config.loop?.splitIfTurnsExceed ?? 1.5;
  const estimate = unit.estimatedTurns || 1;
  if (actualTurns <= estimate * factor) return { split: false };
  const msg = `Unit ${unit.id} used ${actualTurns} turns (estimate ${estimate}). contextRisk suggests split.`;
  const ans = await confirmSplit(msg);
  // Always record recommendation
  const log = path.join(root, 'harness', 'state', 'split-recommendations.log');
  fs.appendFileSync(
    log,
    `${new Date().toISOString()} ${msg} proceed=${ans.proceed} split=${ans.split}\n`,
  );
  return ans;
}

export { isTTY };
