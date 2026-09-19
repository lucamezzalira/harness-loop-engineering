import fs from 'node:fs';
import path from 'node:path';

export function readSession(root) {
  const p = path.join(root, 'harness', 'state', 'session.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeSession(root, session) {
  const dir = path.join(root, 'harness', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(session, null, 2) + '\n');
}

export function recordUsage(root, { role, unitId, usage }) {
  const session = readSession(root) || { id: 'unknown', roles: {}, units: {}, estimated: false };
  session.roles = session.roles || {};
  session.units = session.units || {};
  const r = session.roles[role] || { calls: 0, in: 0, out: 0, cost: 0 };
  r.calls += 1;
  r.in += usage?.inputTokens || 0;
  r.out += usage?.outputTokens || 0;
  r.cost += usage?.costUsd || 0;
  session.roles[role] = r;
  if (usage?.estimated) session.estimated = true;
  if (unitId) {
    session.units[unitId] = (session.units[unitId] || 0) + (usage?.costUsd || 0);
  }
  writeSession(root, session);
  return session;
}

/**
 * Print session cost/token recap.
 */
export function renderReport(root, sessionId) {
  let session = readSession(root);
  if (sessionId && session?.id !== sessionId) {
    const alt = path.join(root, 'harness', 'state', 'logs', sessionId, 'session.json');
    if (fs.existsSync(alt)) session = JSON.parse(fs.readFileSync(alt, 'utf8'));
  }
  if (!session) return 'No session.json found. Run a plan/loop first.\n';

  const roles = session.roles || {};
  const lines = [];
  const elapsed = session.startedAt
    ? formatDuration(Date.now() - new Date(session.startedAt).getTime())
    : '?';
  lines.push(
    `Session ${session.id} · ${session.prdSlug || session.prd || '?'} · ${elapsed} · ${session.turns || 0} turns`,
  );
  lines.push('');
  lines.push('  ROLE          CALLS    IN        OUT       COST');
  let totalCalls = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;
  for (const [name, r] of Object.entries(roles)) {
    lines.push(
      `  ${name.padEnd(14)}${String(r.calls).padStart(5)}    ${String(r.in).padStart(8)}  ${String(r.out).padStart(8)}   $${(r.cost || 0).toFixed(2)}`,
    );
    totalCalls += r.calls;
    totalIn += r.in;
    totalOut += r.out;
    totalCost += r.cost || 0;
  }
  lines.push('  ────────────────────────────────────────────────');
  const est = session.estimated ? '        (estimated)' : '';
  lines.push(
    `  total${''.padEnd(9)}${String(totalCalls).padStart(5)}    ${String(totalIn).padStart(8)}  ${String(totalOut).padStart(8)}   $${totalCost.toFixed(2)}${est}`,
  );
  lines.push('');
  const byUnit = Object.entries(session.units || {})
    .map(([u, c]) => `${u} $${Number(c).toFixed(2)}`)
    .join(' · ');
  if (byUnit) lines.push(`  by unit    ${byUnit}`);
  if (session.panelCycles) {
    lines.push(
      `  panel cycles   ${Object.entries(session.panelCycles)
        .map(([u, n]) => `${u}: ${n}`)
        .join('   ')}`,
    );
  }
  const backlogPath = path.join(root, 'harness', 'state', 'backlog.json');
  if (fs.existsSync(backlogPath)) {
    const b = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));
    const p2 = b.items?.filter((i) => i.severity === 'P2').length || 0;
    const p3 = b.items?.filter((i) => i.severity === 'P3').length || 0;
    lines.push(`  backlogged     ${b.items?.length || 0} (P2: ${p2}, P3: ${p3})`);
  }
  lines.push(`  stopped        ${session.stopReason || 'n/a'}`);
  return lines.join('\n') + '\n';
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
