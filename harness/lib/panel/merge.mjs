import { mapCategory, severityRank } from '../severity.mjs';

/**
 * Deduplicate findings by file + overlapping line range; keep highest mapped severity.
 * @param {Array} findings - { role, category, file, line?, endLine?, message, cwe? }
 * @param {Record<string,string>} severityMap
 */
export function mergeFindings(findings, severityMap) {
  const enriched = findings.map((f) => ({
    ...f,
    severity: mapCategory(f.category || 'default', severityMap),
  }));

  const kept = [];
  for (const f of enriched) {
    const start = f.line ?? 0;
    const end = f.endLine ?? start;
    const dupIdx = kept.findIndex((k) => {
      if ((k.file || '') !== (f.file || '')) return false;
      const ks = k.line ?? 0;
      const ke = k.endLine ?? ks;
      return rangesOverlap(start, end, ks, ke);
    });
    if (dupIdx < 0) {
      kept.push(f);
      continue;
    }
    if (severityRank(f.severity) < severityRank(kept[dupIdx].severity)) {
      kept[dupIdx] = f;
    }
  }
  return kept.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function rangesOverlap(a1, a2, b1, b2) {
  if (a1 === 0 && a2 === 0 && b1 === 0 && b2 === 0) return true; // same file, no lines → treat as dup
  return a1 <= b2 && b1 <= a2;
}

/**
 * @param {Array} merged
 * @param {string[]} blockAt
 */
export function partitionByPolicy(merged, blockAt = ['P0', 'P1']) {
  const blocking = merged.filter((f) => blockAt.includes(f.severity));
  const backlogged = merged.filter((f) => !blockAt.includes(f.severity));
  return { blocking, backlogged };
}

/**
 * Render review.md table
 */
export function renderReviewTable({
  blocking,
  backlogged,
  unitId = '-',
  cycle = 1,
  diffRange = '?',
}) {
  const lines = [
    `Review: ${blocking.length} blocking, ${backlogged.length} backlogged           unit ${unitId} · cycle ${cycle} · diff ${diffRange}`,
    '',
    ' SEV  ROLE      FILE:LINE                      FINDING',
  ];
  for (const f of blocking) {
    lines.push(formatRow(f));
  }
  if (blocking.length && backlogged.length) lines.push(' ---');
  for (const f of backlogged) {
    lines.push(formatRow(f));
  }
  return lines.join('\n') + '\n';
}

function formatRow(f) {
  const loc = f.line != null ? `${f.file || '?'}:${f.line}` : f.file || '?';
  return ` ${f.severity.padEnd(4)} ${(f.role || '?').padEnd(9)} ${loc.padEnd(30)} ${f.message || f.finding || ''}`;
}
