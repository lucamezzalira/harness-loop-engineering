import fs from 'node:fs';
import path from 'node:path';
import { invokeRole } from '../agents/invoke.mjs';
import { resolveRoleBinding } from '../config.mjs';

export function buildDeterministicSection(stats = {}) {
  const lines = ['## Deterministic', ''];
  lines.push('turns:');
  for (const id of Object.keys(stats.turnsByUnit || {}).sort()) {
    lines.push(`  ${id}: ${stats.turnsByUnit[id]}`);
  }
  lines.push('costUsd:');
  for (const id of Object.keys(stats.costByUnit || {}).sort()) {
    lines.push(`  ${id}: ${Number(stats.costByUnit[id]).toFixed(2)}`);
  }
  lines.push('checks:');
  const checks = [...(stats.checks || [])].sort((a, b) => a.name.localeCompare(b.name));
  for (const check of checks) {
    lines.push(`  ${check.name}: failed ${check.failed}, streak ${check.streak}`);
  }
  lines.push(`stalls: ${(stats.stalls || []).length}`);
  lines.push(`unclosable: ${(stats.unclosable || []).slice().sort().join(', ') || '0'}`);
  lines.push(`needs-human: ${(stats.needsHuman || []).slice().sort().join(', ') || '0'}`);
  lines.push('panel:');
  const panel = stats.panelCategories || {};
  for (const role of Object.keys(panel).sort()) {
    const cats = panel[role] || {};
    const bits = Object.keys(cats)
      .sort()
      .map((cat) => `${cat}=${cats[cat]}`);
    lines.push(`  ${role}: ${bits.join(', ')}`);
  }
  lines.push(`mutants: ${(stats.mutants || []).length}`);
  lines.push('timeSec:');
  for (const id of Object.keys(stats.timeByUnit || {}).sort()) {
    lines.push(`  ${id}: ${stats.timeByUnit[id]}`);
  }
  lines.push('dismissedRate:');
  const dismissed = stats.dismissedByRole || {};
  const totals = stats.findingTotals || {};
  const roles = [...new Set([...Object.keys(totals), ...Object.keys(dismissed)])].sort();
  for (const role of roles) {
    const raw = dismissed[role];
    const row = totals[role];
    if (row && typeof row === 'object') {
      const n = Number(row.dismissed ?? raw ?? 0);
      const total = Number(row.total || 0);
      const rate = total ? Math.round((n / total) * 100) : 0;
      lines.push(`  ${role}: ${n}/${total} (${rate}%)`);
    } else {
      lines.push(`  ${role}: ${raw}`);
    }
  }
  lines.push('checkEdits:');
  const edits = [...(stats.checkEdits || [])].sort((a, b) =>
    String(a.at).localeCompare(String(b.at)),
  );
  if (!edits.length) lines.push('  (none)');
  for (const edit of edits) {
    const paths = Array.isArray(edit.paths) ? edit.paths.join(',') : '';
    lines.push(`  ${edit.at} ${edit.by} ${paths} ${edit.reason}`);
  }
  return lines.join('\n');
}

export function capProposals(text, limit = 3) {
  const raw = String(text || '').trim();
  if (!raw) return 'No proposals.';
  const items = raw
    .split(/\n(?=\d+\.\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length <= 1) return raw;
  return items.slice(0, limit).join('\n');
}

export async function composeWaveRetro(
  root,
  config,
  { sessionId, wave, stats, proposedRules = '' },
) {
  const deterministic = buildDeterministicSection(stats);
  let proposalBody = 'No proposals.';
  const binding = resolveRoleBinding(config, 'reviewer');
  if (binding) {
    const result = await invokeRole({
      root,
      config,
      binding,
      systemPrompt:
        'You write a harness retro. Propose at most 3 harness changes (a rule, a skill step, a sensor, or a guidance line). Each proposal cites evidence from the deterministic section. Text only. Do not edit files.',
      userPrompt: `Harness retro for wave ${wave}.\n\n${deterministic}\n\nRecurring categories:\n${proposedRules || '(none)'}`,
      expect: 'text',
    });
    proposalBody = capProposals(result.text || result.data || '');
  }
  const body = `# Wave ${wave}\n\n${deterministic}\n\n## Proposals\n\n${proposalBody}\n`;
  const dir = path.join(root, 'harness', 'retro', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `wave-${wave}.md`);
  fs.writeFileSync(file, body);
  return file;
}
