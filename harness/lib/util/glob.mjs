/**
 * Minimal glob matcher (**, *, ?) without a dependency.
 */
export function minimatchLike(file, pattern) {
  const f = file.replace(/\\/g, '/');
  const p = pattern.replace(/\\/g, '/');
  const re = globToRegExp(p);
  return re.test(f);
}

function globToRegExp(glob) {
  let s = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        s += '(?:.*/)?';
        i += 2;
      } else {
        s += '.*';
        i += 1;
      }
    } else if (c === '*') {
      s += '[^/]*';
    } else if (c === '?') {
      s += '[^/]';
    } else if ('+.^$()[]{}|'.includes(c)) {
      s += '\\' + c;
    } else {
      s += c;
    }
  }
  // Pattern is an escaped harness glob (touches / triggers), not network input.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp
  return new RegExp(`^${s}$`);
}
