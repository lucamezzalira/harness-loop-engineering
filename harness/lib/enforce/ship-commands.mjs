export const DEFAULT_SHIP_COMMANDS = [
  'gh pr edit --add-label',
  'gh pr edit --remove-label',
  'gh pr review --approve',
  'gh pr merge',
  'gh label',
  'gh api /labels',
  'gh api /reviews',
  'gh api /merge',
];

export function shipCommandHit(command, rules = DEFAULT_SHIP_COMMANDS) {
  const text = String(command || '').replace(/\s+/g, ' ');
  for (const rule of rules || []) {
    const tokens = String(rule).split(/\s+/).filter(Boolean);
    if (tokens.length && tokens.every((token) => text.includes(token))) return String(rule);
  }
  return '';
}
