import { partitionByPolicy } from './merge.mjs';

const BLOCKING_BY_DEFAULT = new Set([
  'reviewer',
  'security',
  'product',
  'planner',
  'qa',
  'infra',
  'test-writer',
  'acceptance-checker',
  'integrity-checker',
]);

export function reviewMode(config, role) {
  const explicit = config?.review?.mode?.[role];
  if (explicit === 'shadow' || explicit === 'advisory' || explicit === 'blocking') return explicit;
  if (BLOCKING_BY_DEFAULT.has(role)) return 'blocking';
  return 'shadow';
}

/**
 * shadow: review.md only. advisory: backlog at any severity. blocking: today's split.
 */
export function routeFindings(findings, mode, blockAt = ['P0', 'P1']) {
  const list = findings || [];
  if (mode === 'shadow') return { blocking: [], backlogged: [], shadow: list };
  if (mode === 'advisory') return { blocking: [], backlogged: list, shadow: [] };
  const split = partitionByPolicy(list, blockAt);
  return { blocking: split.blocking, backlogged: split.backlogged, shadow: [] };
}
