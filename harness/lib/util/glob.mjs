/**
 * Minimal glob matcher (**, *, ?) without a dependency or dynamic RegExp.
 */
export function minimatchLike(file, pattern) {
  const f = file.replace(/\\/g, '/');
  const p = pattern.replace(/\\/g, '/');
  return matchGlob(f, p);
}

/**
 * Recursive string matcher for harness globs (config/plan paths, not network input).
 * @param {string} text
 * @param {string} pattern
 * @returns {boolean}
 */
function matchGlob(text, pattern) {
  let ti = 0;
  let pi = 0;
  let starText = -1;
  let starPat = -1;

  while (ti < text.length) {
    if (
      pi < pattern.length &&
      pattern[pi] === '*' &&
      pattern[pi + 1] === '*'
    ) {
      // ** or **/
      const slashAfter = pattern[pi + 2] === '/';
      starPat = pi;
      starText = ti;
      pi += slashAfter ? 3 : 2;
      if (pi >= pattern.length) return true;
      continue;
    }
    if (pi < pattern.length && pattern[pi] === '*') {
      // single-segment *
      const next = pattern[pi + 1];
      if (next == null) {
        return !text.slice(ti).includes('/');
      }
      // consume until next pattern char or end of segment
      starPat = pi;
      starText = ti;
      pi += 1;
      continue;
    }
    if (pi < pattern.length && pattern[pi] === '?') {
      if (text[ti] === '/') return false;
      ti += 1;
      pi += 1;
      continue;
    }
    if (pi < pattern.length && pattern[pi] === text[ti]) {
      ti += 1;
      pi += 1;
      continue;
    }
    // backtrack to last *
    if (starPat >= 0) {
      if (pattern[starPat] === '*' && pattern[starPat + 1] === '*') {
        starText += 1;
        ti = starText;
        pi = starPat + (pattern[starPat + 2] === '/' ? 3 : 2);
        continue;
      }
      // single *
      if (text[starText] === '/') return false;
      starText += 1;
      ti = starText;
      pi = starPat + 1;
      continue;
    }
    return false;
  }

  // consume trailing ** and *
  while (pi < pattern.length) {
    if (pattern[pi] === '*' && pattern[pi + 1] === '*') {
      pi += pattern[pi + 2] === '/' ? 3 : 2;
      continue;
    }
    if (pattern[pi] === '*') {
      pi += 1;
      continue;
    }
    break;
  }
  return pi >= pattern.length;
}
