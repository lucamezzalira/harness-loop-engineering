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
  for (const role of Object.keys(dismissed).sort()) {
    lines.push(`  ${role}: ${dismissed[role]}`);
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

export async function composeWaveRetro(root, config, { sessionId, wave, stats, proposedRules = '' }) {
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
