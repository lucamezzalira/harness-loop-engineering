import { readSession } from '../accounting.mjs';

export function adoptPanelSession(root, session) {
  const disk = readSession(root);
  if (!disk || !session) return session;
  if (disk.reviewFindings) session.reviewFindings = disk.reviewFindings;
  return session;
}

export function findingKey(finding) {
  return [finding.role, finding.file, finding.line, finding.category, finding.message].join('|');
}

/**
 * A finding missing from a later panel is fixed when its file changed,
 * and stays open when the file did not.
 */
export function reconcileFindings(previous, current, changedFiles) {
  const changed = new Set(changedFiles || []);
  const currentKeys = new Set((current || []).map(findingKey));
  const next = (current || []).map((finding) => ({
    ...finding,
    outcome: finding.outcome || 'open',
  }));
  for (const prev of previous || []) {
    if (currentKeys.has(findingKey(prev))) continue;
    if (prev.outcome === 'dismissed' || prev.outcome === 'promoted' || prev.outcome === 'fixed') {
      next.push(prev);
      continue;
    }
    if (prev.file && changed.has(prev.file)) next.push({ ...prev, outcome: 'fixed' });
    else next.push({ ...prev, outcome: 'open' });
  }
  return next;
}
