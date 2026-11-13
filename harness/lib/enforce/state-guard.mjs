/**
 * Shell writes under protect.stateDir. Pattern names live in harness.yaml.
 * Matchers are literal so a config string is never compiled as a RegExp.
 */

export const DEFAULT_STATE_DIR = 'harness/state';

export const DEFAULT_STATE_WRITES = Object.freeze([
  'redirect',
  'tee',
  'cp',
  'mv',
  'rm',
  'truncate',
  'sed-in-place',
  'node-eval',
  'python-eval',
  'allow-check-edit',
]);

/**
 * @param {object | null | undefined} config
 */
export function stateGuardFromConfig(config) {
  const protect = config?.protect || {};
  const stateDir = String(protect.stateDir || DEFAULT_STATE_DIR)
    .replace(/\\/g, '/')
    .replace(/\/$/, '');
  const listed = protect.stateWrites;
  const stateWrites =
    Array.isArray(listed) && listed.length ? listed.map(String) : [...DEFAULT_STATE_WRITES];
  return { stateDir, stateWrites };
}

/**
 * @param {string} rel
 * @param {string} stateDir
 */
export function pathUnderState(rel, stateDir = DEFAULT_STATE_DIR) {
  const file = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  const dir = String(stateDir || DEFAULT_STATE_DIR)
    .replace(/\\/g, '/')
    .replace(/\/$/, '');
  return file === dir || file.startsWith(`${dir}/`);
}

/**
 * @param {string} command
 * @param {{ stateDir: string, stateWrites: string[] }} guard
 * @returns {string[]}
 */
export function shellStateRefusal(command, guard) {
  const cmd = String(command || '');
  const writes = guard?.stateWrites || [];
  const dir = guard?.stateDir || DEFAULT_STATE_DIR;
  const reasons = [];
  if (writes.includes('allow-check-edit') && cmd.includes('--allow-check-edit')) {
    reasons.push(
      'refused: --allow-check-edit is only run by the developer, from their own terminal',
    );
  }
  const hits = matchingWrites(cmd, dir, writes);
  if (hits.length) {
    reasons.push(`refused: shell command writes under ${dir} (${hits.join(', ')})`);
  }
  return reasons;
}

function matchingWrites(command, dir, enabled) {
  const hits = [];
  if (enabled.includes('redirect') && redirectTo(command, dir)) hits.push('redirect');
  for (const segment of String(command).split(/&&|\|\||[|;\n]/)) {
    const argv = words(segment);
    if (!argv.length) continue;
    const bin = baseBin(argv[0]);
    if (enabled.includes('tee') && bin === 'tee' && argsTouch(argv, dir)) hits.push('tee');
    if (enabled.includes('cp') && bin === 'cp' && underState(destOf(argv), dir)) hits.push('cp');
    if (enabled.includes('mv') && bin === 'mv' && underState(destOf(argv), dir)) hits.push('mv');
    if (enabled.includes('rm') && bin === 'rm' && argsTouch(argv, dir)) hits.push('rm');
    if (enabled.includes('truncate') && bin === 'truncate' && argsTouch(argv, dir)) {
      hits.push('truncate');
    }
    if (enabled.includes('sed-in-place') && bin === 'sed' && sedInPlace(argv, dir)) {
      hits.push('sed-in-place');
    }
    if (
      enabled.includes('node-eval') &&
      bin === 'node' &&
      hasFlag(argv, ['-e', '--eval']) &&
      argsTouch(argv, dir)
    ) {
      hits.push('node-eval');
    }
    if (
      enabled.includes('python-eval') &&
      (bin === 'python' || bin === 'python3') &&
      hasFlag(argv, ['-c']) &&
      argsTouch(argv, dir)
    ) {
      hits.push('python-eval');
    }
  }
  return [...new Set(hits)];
}

function baseBin(word) {
  const text = String(word || '');
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return slash >= 0 ? text.slice(slash + 1) : text;
}

function words(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(segment))) {
    out.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return out;
}

function destOf(argv) {
  const args = argv.slice(1).filter((word) => word && !word.startsWith('-'));
  return args[args.length - 1] || '';
}

function argsTouch(argv, dir) {
  return argv.slice(1).some((word) => word && !word.startsWith('-') && underState(word, dir));
}

function hasFlag(argv, flags) {
  return argv.some(
    (word) => flags.includes(word) || (flags.includes('--eval') && word.startsWith('--eval=')),
  );
}

function sedInPlace(argv, dir) {
  const inplace = argv.some((word) => word === '-i' || word.startsWith('-i'));
  return inplace && argsTouch(argv, dir);
}

function underState(token, dir) {
  const text = String(token || '').replace(/\\/g, '/');
  if (text === dir || text.endsWith(`/${dir}`)) return true;
  return text.includes(`${dir}/`);
}

function redirectTo(command, dir) {
  const cmd = String(command);
  for (let i = 0; i < cmd.length; i += 1) {
    if (cmd[i] !== '>') continue;
    if (cmd[i + 1] === '=') continue;
    if (i > 0 && (cmd[i - 1] === '-' || cmd[i - 1] === '>')) continue;
    let j = i + 1;
    if (cmd[j] === '>') j += 1;
    while (cmd[j] === ' ' || cmd[j] === '\t') j += 1;
    if (cmd[j] === '&') continue;
    let quote = '';
    if (cmd[j] === '"' || cmd[j] === "'") {
      quote = cmd[j];
      j += 1;
    }
    let token = '';
    while (j < cmd.length) {
      const ch = cmd[j];
      if (quote) {
        if (ch === quote) break;
      } else if (
        ch === ' ' ||
        ch === '\t' ||
        ch === '|' ||
        ch === ';' ||
        ch === '&' ||
        ch === '\n'
      ) {
        break;
      }
      token += ch;
      j += 1;
    }
    if (underState(token, dir)) return true;
  }
  return false;
}
