/**
 * One survivor per line, then at most 7 times the changed-file count.
 */
export function survivorsToFindings(report, { changedFiles = [] } = {}) {
  const mutants = flattenMutants(report);
  const survived = mutants.filter((m) => String(m.status || '').toLowerCase() === 'survived');
  const byLine = new Map();
  for (const mutant of survived) {
    const file = mutant.file || mutant.source || '?';
    const line = mutant.location?.start?.line || mutant.line || 0;
    const key = `${file}:${line}`;
    if (byLine.has(key)) continue;
    byLine.set(key, {
      category: 'mutant-survived',
      file,
      line,
      mutator: mutant.mutatorName || mutant.mutator?.name || mutant.mutator || 'unknown',
      message: `mutant survived (${mutant.mutatorName || mutant.mutator?.name || 'unknown'})`,
      severity: 'P2',
    });
  }
  const cap = 7 * Math.max(changedFiles.length, 0);
  const all = [...byLine.values()];
  if (changedFiles.length === 0) return all;
  return all.slice(0, cap);
}

function flattenMutants(report) {
  if (!report || typeof report !== 'object') return [];
  if (Array.isArray(report.mutants)) {
    return report.mutants.map((m) => ({ ...m, file: m.file || m.source }));
  }
  const files = report.files || {};
  const out = [];
  for (const [file, data] of Object.entries(files)) {
    for (const mutant of data?.mutants || []) out.push({ ...mutant, file });
  }
  return out;
}

export function mutationWhere(config, yamlWhere = ['ci']) {
  if (config?.mutation?.local === true) return ['local', 'ci'];
  return yamlWhere;
}
