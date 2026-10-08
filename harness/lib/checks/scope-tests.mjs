import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Map changed files to scoped test invocations so turn-tier unit checks
 * do not re-run the whole monorepo.
 *
 * @param {string} root
 * @param {string[]} changedFiles
 * @returns {{ mode: 'full' | 'scoped' | 'none', runs: { label: string, argv: string[] }[] }}
 */
export function planScopedTests(root, changedFiles) {
  const files = (changedFiles || [])
    .map((f) => String(f || '').replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean)
    .filter((f) => !f.startsWith('harness/state/') && f !== 'HANDOFF.md');

  if (!files.length) {
    return { mode: 'full', runs: [{ label: 'full', argv: ['npm', 'test', '--silent'] }] };
  }

  const runs = [];
  const seen = new Set();
  const add = (label, argv) => {
    const key = argv.join('\0');
    if (seen.has(key)) return;
    seen.add(key);
    runs.push({ label, argv });
  };

  const nodeTestFiles = new Set();
  const prefixes = new Set();

  for (const f of files) {
    const colocated = colocatedTest(root, f);
    if (colocated) nodeTestFiles.add(colocated);

    if (f.startsWith('harness/') || f.startsWith('scripts/')) {
      for (const t of testsNear(root, f)) nodeTestFiles.add(t);
      continue;
    }

    const svc = f.match(/^services\/([^/]+)\//);
    if (svc) {
      prefixes.add(`services/${svc[1]}`);
      continue;
    }
    const pkg = f.match(/^packages\/([^/]+)\//);
    if (pkg) {
      prefixes.add(`packages/${pkg[1]}`);
      continue;
    }
    if (f.startsWith('infra/')) {
      prefixes.add('infra');
      continue;
    }
    const ex = f.match(/^examples\/([^/]+)\//);
    if (ex) {
      prefixes.add(`examples/${ex[1]}`);
      continue;
    }
    const app = f.match(/^apps\/([^/]+)\//);
    if (app) {
      prefixes.add(`apps/${app[1]}`);
      continue;
    }
  }

  for (const prefix of prefixes) {
    const pkgJson = path.join(root, prefix, 'package.json');
    if (fs.existsSync(pkgJson)) {
      let hasTest = false;
      try {
        hasTest = Boolean(JSON.parse(fs.readFileSync(pkgJson, 'utf8')).scripts?.test);
      } catch {
        hasTest = false;
      }
      if (hasTest) {
        add(prefix, ['npm', 'test', '--silent', '--prefix', prefix]);
        continue;
      }
    }
    for (const t of findTestsUnder(root, prefix)) nodeTestFiles.add(t);
  }

  if (nodeTestFiles.size) {
    const list = [...nodeTestFiles].sort();
    add('node-test', ['node', '--test', ...list]);
  }

  if (!runs.length) return { mode: 'none', runs: [] };
  return { mode: 'scoped', runs };
}

function colocatedTest(root, file) {
  if (file.endsWith('.test.mjs') || file.endsWith('.test.js')) {
    return fs.existsSync(path.join(root, file)) ? file : null;
  }
  const candidates = [];
  if (file.endsWith('.mjs')) candidates.push(file.replace(/\.mjs$/, '.test.mjs'));
  if (file.endsWith('.js')) {
    candidates.push(file.replace(/\.js$/, '.test.mjs'), file.replace(/\.js$/, '.test.js'));
  }
  if (file.endsWith('.ts') || file.endsWith('.tsx')) {
    candidates.push(file.replace(/\.tsx?$/, '.test.mjs'));
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(root, c))) return c;
  }
  return null;
}

function testsNear(root, file) {
  const dir = path.posix.dirname(file);
  const absDir = path.join(root, dir);
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(absDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.endsWith('.test.mjs') || name.endsWith('.test.js')) {
      out.push(path.posix.join(dir, name));
    }
  }
  const base = path.posix.basename(file).replace(/\.(mjs|js|ts|tsx)$/, '');
  for (const name of entries) {
    if (name.startsWith(base) && (name.endsWith('.test.mjs') || name.endsWith('.test.js'))) {
      out.push(path.posix.join(dir, name));
    }
  }
  return out;
}

function findTestsUnder(root, prefix) {
  const abs = path.join(root, prefix);
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && (ent.name.endsWith('.test.mjs') || ent.name.endsWith('.test.js'))) {
        out.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
  }
  return out;
}

/**
 * CLI: read HARNESS_CHANGED_FILES, run scoped or full tests, exit with status.
 */
export function runScopedTestsCli(root = process.cwd(), env = process.env) {
  const raw = env.HARNESS_CHANGED_FILES || '';
  const files = raw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const forceFull = env.HARNESS_UNIT_FULL === '1';
  const plan = forceFull
    ? { mode: 'full', runs: [{ label: 'full', argv: ['npm', 'test', '--silent'] }] }
    : planScopedTests(root, files);

  if (plan.mode === 'none') {
    console.log('unit: no tests in scope for changed files (ok)');
    return 0;
  }

  if (plan.mode === 'scoped') {
    console.log(`unit: scoped (${plan.runs.map((r) => r.label).join(', ')})`);
  }

  for (const run of plan.runs) {
    const [cmd, ...args] = run.argv;
    const res = spawnSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
      shell: false,
    });
    const out = [res.stdout, res.stderr].filter(Boolean).join('');
    if (out) process.stdout.write(out);
    if (res.status === 127 || (res.error && res.error.code === 'ENOENT')) {
      console.error('test runner missing; run npm install at repo root');
      return 3;
    }
    if (res.status !== 0) return res.status ?? 1;
  }
  return 0;
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) process.exit(runScopedTestsCli());
