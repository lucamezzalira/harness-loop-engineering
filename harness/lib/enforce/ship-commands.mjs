export const DEFAULT_SHIP_COMMANDS = [
  'gh pr edit --add-label',
  'gh pr edit --remove-label',
  'gh pr review --approve',
  'gh pr review -a',
  'gh pr review --request-changes',
  'gh pr review -r',
  'gh pr merge',
  'gh label',
  'gh api /labels',
  'gh api /reviews',
  'gh api /merge',
  'gh api graphql mutation',
  'curl',
  'wget',
  'http',
  'node -e',
  'python -c',
];

const METHODS = ['PUT', 'POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const TOKEN_NAMES = ['GH_ENTERPRISE_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];

export function shipCommandHit(command, rules = DEFAULT_SHIP_COMMANDS) {
  const text = String(command || '')
    .replace(/\s+/g, ' ')
    .trim();
  const list = Array.isArray(rules) ? rules.map((rule) => String(rule)) : [];
  return hitText(text, list, new Set());
}

function hitText(text, list, seen) {
  if (!text || seen.has(text)) return '';
  seen.add(text);
  return (
    reviewHit(text, list) ||
    graphqlHit(text, list) ||
    httpHit(text, list) ||
    tokenHit(text, list) ||
    unwrapHit(text, list, seen) ||
    ''
  );
}

function reviewHit(text, rules) {
  const tokens = words(text);
  const names = tokens.map(commandName);
  if (!names.includes('gh') || !tokens.includes('pr') || !tokens.includes('review')) return '';
  if (rules.includes('gh pr review --approve') && flagOn(tokens, '--approve')) {
    return 'gh pr review --approve';
  }
  if (rules.includes('gh pr review --request-changes') && flagOn(tokens, '--request-changes')) {
    return 'gh pr review --request-changes';
  }
  if (rules.includes('gh pr review -a') && shortFlag(tokens, 'a')) return 'gh pr review -a';
  if (rules.includes('gh pr review -r') && shortFlag(tokens, 'r')) return 'gh pr review -r';
  return '';
}

function graphqlHit(text, rules) {
  if (!rules.includes('gh api graphql mutation')) return '';
  const tokens = words(text);
  const names = tokens.map(commandName);
  if (!names.includes('gh') || !tokens.includes('api') || !tokens.includes('graphql')) return '';
  if (!hasKeyword(text, 'mutation')) return '';
  return 'gh api graphql mutation';
}

function httpHit(text, rules) {
  const client = whichClient(text, rules);
  if (!client) return '';
  for (const name of TOKEN_NAMES) {
    if (text.includes(name)) return `${client} ${name}`;
  }
  if (text.includes('api.github.com') && nonGet(client, text)) return `${client} api.github.com`;
  return '';
}

function tokenHit(text, rules) {
  for (const rule of rules) {
    if (interpreted(rule)) continue;
    const tokens = String(rule).split(/\s+/).filter(Boolean);
    if (tokens.length && tokens.every((token) => text.includes(token))) return rule;
  }
  return '';
}

function interpreted(rule) {
  return (
    rule.startsWith('gh pr review ') ||
    rule === 'gh api graphql mutation' ||
    rule === 'curl' ||
    rule === 'wget' ||
    rule === 'http' ||
    rule === 'node -e' ||
    rule === 'python -c'
  );
}

function whichClient(text, rules) {
  const tokens = words(text);
  const names = tokens.map(commandName);
  if (rules.includes('curl') && names.includes('curl')) return 'curl';
  if (rules.includes('wget') && names.includes('wget')) return 'wget';
  if (rules.includes('http') && names.includes('http')) return 'http';
  if (rules.includes('node -e') && names.includes('node') && tokens.includes('-e'))
    return 'node -e';
  if (
    rules.includes('python -c') &&
    (names.includes('python') || names.includes('python3')) &&
    tokens.includes('-c')
  ) {
    return 'python -c';
  }
  return '';
}

function nonGet(client, text) {
  if (client === 'curl') return curlNonGet(words(text));
  if (client === 'wget') return wgetNonGet(words(text));
  if (client === 'http') return httpieNonGet(words(text));
  return scriptNonGet(text);
}

function curlNonGet(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if ((token === '-X' || token === '--request') && METHODS.includes(upper(tokens[i + 1]))) {
      return true;
    }
    if (token.startsWith('-X') && token.length > 2 && METHODS.includes(upper(token.slice(2)))) {
      return true;
    }
    if (
      token.startsWith('--request=') &&
      METHODS.includes(upper(token.slice('--request='.length)))
    ) {
      return true;
    }
    if (token === '-d' || token === '-T' || token === '-I' || token === '--head') return true;
    if (
      token.startsWith('--data') ||
      token === '--upload-file' ||
      token.startsWith('--upload-file=')
    ) {
      return true;
    }
  }
  return false;
}

function wgetNonGet(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--method' && METHODS.includes(upper(tokens[i + 1]))) return true;
    if (token.startsWith('--method=') && METHODS.includes(upper(token.slice('--method='.length)))) {
      return true;
    }
    if (token === '--post-data' || token.startsWith('--post-data=')) return true;
    if (token === '--post-file' || token.startsWith('--post-file=')) return true;
  }
  return false;
}

function httpieNonGet(tokens) {
  return tokens.some((token) => METHODS.includes(upper(token)));
}

function scriptNonGet(text) {
  if (!text.includes('api.github.com')) return false;
  return METHODS.some((method) => text.includes(method));
}

function unwrapHit(text, list, seen) {
  const tokens = words(text);
  for (let i = 0; i < tokens.length; i++) {
    const name = commandName(tokens[i]);
    const quoteAt =
      (name === 'sh' || name === 'bash' || name === 'zsh') && tokens[i + 1] === '-c'
        ? i + 2
        : name === 'eval'
          ? i + 1
          : -1;
    if (quoteAt < 0) continue;
    const inner = quotedCommand(tokens, quoteAt);
    const hit = inner ? hitText(inner, list, seen) : '';
    if (hit) return hit;
  }
  return '';
}

function quotedCommand(tokens, start) {
  const first = tokens[start] || '';
  const quote = first[0];
  if (quote !== '"' && quote !== "'") return '';
  if (first.length > 1 && first.endsWith(quote)) return first.slice(1, -1);
  const parts = [first.slice(1)];
  for (let j = start + 1; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.endsWith(quote)) {
      parts.push(token.slice(0, -1));
      return parts.join(' ');
    }
    parts.push(token);
  }
  return '';
}

function flagOn(tokens, name) {
  const prefix = `${name}=`;
  return tokens.some((token) => {
    if (token === name) return true;
    if (!token.startsWith(prefix)) return false;
    const value = token.slice(prefix.length).toLowerCase();
    return value === 'true' || value === '1';
  });
}

function shortFlag(tokens, letter) {
  return tokens.some((token) => {
    if (!token.startsWith('-') || token.startsWith('--')) return false;
    return token.slice(1).includes(letter);
  });
}

function hasKeyword(text, word) {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(word, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + word.length] || '';
    if (!isId(before) && !isId(after)) return true;
    from = at + word.length;
  }
  return false;
}

function isId(ch) {
  return Boolean(ch) && /[A-Za-z0-9_]/.test(ch);
}

function words(text) {
  return text.split(' ').filter(Boolean);
}

function commandName(token) {
  const slash = token.lastIndexOf('/');
  return slash >= 0 ? token.slice(slash + 1) : token;
}

function upper(value) {
  return String(value || '').toUpperCase();
}
