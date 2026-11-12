export function findingTotalsFromSession(session = {}) {
  const out = {};
  for (const finding of session.reviewFindings || []) {
    const role = finding.role || '?';
    const row = out[role] || { total: 0, fixed: 0, dismissed: 0 };
    row.total += 1;
    if (finding.outcome === 'fixed') row.fixed += 1;
    if (finding.outcome === 'dismissed') row.dismissed += 1;
    out[role] = row;
  }
  for (const [role, n] of Object.entries(session.dismissedByRole || {})) {
    const row = out[role] || { total: 0, fixed: 0, dismissed: 0 };
    row.dismissed = Math.max(row.dismissed, Number(n) || 0);
    out[role] = row;
  }
  return out;
}

export function classifyOutcome(finding) {
  if (!finding) return 'open';
  if (finding.fixed === true || finding.outcome === 'fixed') return 'fixed';
  if (finding.dismissed === true || finding.outcome === 'dismissed') return 'dismissed';
  return 'open';
}

export function renderReviewMetrics(session = {}, extras = {}) {
  const findings = session.reviewFindings || [];
  const byRole = new Map();
  for (const finding of findings) {
    const role = finding.role || '?';
    const category = finding.category || '?';
    const key = `${role}/${category}`;
    byRole.set(key, (byRole.get(key) || 0) + 1);
  }
  const lines = ['Review', ''];
  lines.push('findings:');
  if (!byRole.size) lines.push('  (none)');
  for (const key of [...byRole.keys()].sort()) {
    lines.push(`  ${key}: ${byRole.get(key)}`);
  }
  lines.push('outcomes:');
  if (!findings.length) lines.push('  (none)');
  for (const finding of findings) {
    const outcome = classifyOutcome(finding);
    const tag = outcome === 'open' ? ' (estimated)' : '';
    lines.push(`  ${finding.role || '?'}/${finding.category || '?'}: ${outcome}${tag}`);
  }
  lines.push('panel cycles:');
  const cycles = session.panelCycles || {};
  const cycleKeys = Object.keys(cycles).sort();
  if (!cycleKeys.length) lines.push('  (none)');
  for (const id of cycleKeys) lines.push(`  ${id}: ${cycles[id]}`);
  const status = session.unitStatus || {};
  const needs = Object.values(status).filter((s) => s === 'needs-human').length;
  const unclosable = Object.values(status).filter((s) => s === 'unclosable').length;
  lines.push(`needs-human: ${needs}`);
  lines.push(`unclosable: ${unclosable}`);
  lines.push(`check-integrity refusals: ${session.checkEditRefusals || 0}`);
  const revert = extras.revertRate ?? session.revertRate;
  if (revert && typeof revert === 'object') {
    const mark = revert.estimated ? ' (estimated)' : '';
    lines.push(`revert rate: ${revert.value}${mark}`);
  } else {
    lines.push('revert rate: 0 (estimated)');
  }
  lines.push('escape rate: out of scope');
  lines.push('by role:');
  const totals = findingTotalsFromSession(session);
  const roles = Object.keys(totals).sort();
  if (!roles.length) lines.push('  (none)');
  for (const role of roles) {
    const row = totals[role];
    const rate = row.total ? Math.round((row.dismissed / row.total) * 100) : 0;
    lines.push(
      `  ${role}: total ${row.total}, fixed ${row.fixed}, dismissed ${row.dismissed}, dismissed rate ${rate}%`,
    );
  }
  return lines.join('\n');
}
