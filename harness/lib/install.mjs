import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { detectToolFromDirs, isTTY, prompt } from './tty.mjs';
import { VALID_TOOLS, writeYaml } from './config.mjs';
import { probeProvider } from './agents/invoke.mjs';
import { renderAdapter } from './render/render.mjs';
import { runChecks } from './checks/runner.mjs';

/**
 * --install: detect, never overwrite team files, audit, wait.
 */
export async function runInstall(root) {
  const detection = detectProject(root);
  const audit = practiceAudit(root, detection);

  // Write harness.yaml defaults merged with detection (don't wipe baselines if present)
  const harnessPath = path.join(root, 'harness.yaml');
  let existing = {};
  if (fs.existsSync(harnessPath)) {
    existing = parseYaml(fs.readFileSync(harnessPath, 'utf8')) || {};
  }

  const baseline = {
    agentsMdLines: countLines(path.join(root, 'AGENTS.md')) || null,
    duplicatedBlocks: existing.baseline?.duplicatedBlocks ?? null,
    maxComplexity: existing.baseline?.maxComplexity ?? null,
  };

  const nextHarness = {
    ...existing,
    project: {
      packageManager: detection.packageManager,
      moduleSystem: detection.moduleSystem,
      servicesGlob: detection.servicesGlob,
      contractsPackage: detection.contractsPackage,
      infraPaths: existing.project?.infraPaths || ['infra/**'],
    },
    baseline: { ...baseline, ...(existing.baseline || {}) },
  };
  // Only write if changed (idempotent)
  const serialized = stringifyYaml(nextHarness) + '\n';
  if (!fs.existsSync(harnessPath) || fs.readFileSync(harnessPath, 'utf8') !== serialized) {
    fs.writeFileSync(harnessPath, serialized);
  }

  // AGENTS.md append block
  ensureAgentsBlock(root);
  ensureClaudePointer(root);

  // Tool selection
  let tool = null;
  const localPath = path.join(root, 'harness.local.yaml');
  let local = fs.existsSync(localPath) ? parseYaml(fs.readFileSync(localPath, 'utf8')) || {} : {};

  if (local.tool && VALID_TOOLS.includes(local.tool)) {
    tool = local.tool;
  } else if (isTTY()) {
    const answer = await prompt(`Which tool? (${VALID_TOOLS.join(' | ')}): `, {
      defaultAnswer: '',
      nonInteractive: '',
    });
    tool = answer.trim();
    if (!VALID_TOOLS.includes(tool)) {
      const err = new Error(
        `tool must be exactly one of: ${VALID_TOOLS.join(', ')}. Got: "${tool || '(empty)'}"`,
      );
      err.exitCode = 2;
      throw err;
    }
  } else {
    tool = detectToolFromDirs(root);
    if (!tool) {
      const err = new Error(
        [
          'Non-interactive --install cannot choose a tool.',
          'Found: no .cursor/, .claude/, or .codex/ directory.',
          'Why: adapters are mutual exclusive; only one tool may be wired.',
          'Create harness.local.yaml with:',
          '',
          'tool: cursor   # or claude | codex',
          'profile: default',
          '',
        ].join('\n'),
      );
      err.exitCode = 2;
      throw err;
    }
  }

  local = {
    ...local,
    tool,
    profile: local.profile || 'default',
    confirmProfile: local.confirmProfile ?? true,
  };
  writeYaml(localPath, local);

  // Probe providers from models.yaml
  const modelsPath = path.join(root, 'harness', 'models.yaml');
  let probeNotes = [];
  if (fs.existsSync(modelsPath)) {
    const models = parseYaml(fs.readFileSync(modelsPath, 'utf8'));
    for (const [name, p] of Object.entries(models.providers || {})) {
      if (p.type === 'openai-compatible') {
        const r = await probeProvider(p);
        probeNotes.push(`${name}: ${r.detail}`);
      }
    }
  }

  // Prefer eslint rules the installer enables
  ensureEslintAgentRules(root);

  // Git pre-commit hook
  installPreCommitHook(root);

  // Render adapter
  const { loadConfig } = await import('./config.mjs');
  const config = loadConfig(root);
  await renderAdapter(root, config);

  // Run verify once
  const report = await runChecks(root, config, { tier: 'commit', failFast: false });

  // Print audit and wait
  console.log('\n=== Practice audit (nothing changed without instruction) ===\n');
  for (const line of audit) console.log(`• ${line}`);
  console.log('\n=== Provider probes ===\n');
  for (const p of probeNotes) console.log(`• ${p}`);
  if (!probeNotes.length) console.log('• (no local providers to probe)');
  console.log('\n=== First verify ===\n');
  for (const c of report.checks) {
    console.log(`• ${c.name}: ${c.status}${c.reason ? ` (${c.reason})` : ''}`);
  }

  if (isTTY()) {
    await prompt(
      '\nInstall complete. Press Enter to continue (nothing else will be fixed automatically). ',
      {
        defaultAnswer: '',
        nonInteractive: '',
      },
    );
  } else {
    console.log('\nNon-interactive: install finished without waiting.');
  }

  return { exitCode: 0, tool, report, audit };
}

function detectProject(root) {
  let packageManager = 'npm';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (fs.existsSync(path.join(root, 'yarn.lock'))) packageManager = 'yarn';
  else if (fs.existsSync(path.join(root, 'bun.lockb'))) packageManager = 'bun';

  let moduleSystem = 'esm';
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.type === 'module') moduleSystem = 'esm';
    else if (pkg.type === 'commonjs') moduleSystem = 'cjs';
    else moduleSystem = 'cjs';
  }

  const servicesGlob = 'services/*';
  let contractsPackage = null;
  const packagesDir = path.join(root, 'packages');
  if (fs.existsSync(packagesDir)) {
    for (const d of fs.readdirSync(packagesDir)) {
      const p = path.join(packagesDir, d, 'package.json');
      if (!fs.existsSync(p)) continue;
      const name = JSON.parse(fs.readFileSync(p, 'utf8')).name;
      if (name && /contracts/.test(name)) contractsPackage = name;
    }
  }

  return { packageManager, moduleSystem, servicesGlob, contractsPackage };
}

function practiceAudit(root, detection) {
  const lines = [];
  const agentsLines = countLines(path.join(root, 'AGENTS.md'));
  if (agentsLines > 200) {
    lines.push(
      `context-budget: AGENTS.md is ${agentsLines} lines (limit 200). Why: context window and instruction following. Fix: trim or move into ADRs/skills. Baseline recorded.`,
    );
  }
  if (
    !fs.existsSync(path.join(root, '.eslintrc.cjs')) &&
    !fs.existsSync(path.join(root, 'eslint.config.js'))
  ) {
    lines.push(
      'lint: no eslint config. Why: agents skip style without a gate. Fix: npm i -D eslint && npx eslint --init',
    );
  }
  if (!fs.existsSync(path.join(root, '.dependency-cruiser.cjs'))) {
    lines.push(
      'boundaries: no dependency-cruiser config. Why: service→service imports pass all other checks. Fix: npm i -D dependency-cruiser && npx depcruise --init',
    );
  }
  if (!commandExists('gitleaks')) {
    lines.push(
      'secrets: gitleaks missing. Why: harness exits 2 without it. Fix: brew install gitleaks',
    );
  }
  if (!detection.contractsPackage) {
    lines.push(
      'contracts: no shared contracts package detected. Why: typed cross-service publish needs one owner. Fix: add packages/contracts and set project.contractsPackage',
    );
  }
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.scripts?.test) {
      lines.push(
        'unit: no test script. Why: turn tier cannot prove behaviour. Fix: add "test" to package.json scripts',
      );
    }
  }
  // Direct service imports (heuristic)
  const services = path.join(root, 'services');
  if (fs.existsSync(services)) {
    lines.push(
      'boundaries: review services/* imports. Why: deep imports couple deployables. Fix: depcruise not-to rules + contracts package',
    );
  }
  if (!lines.length) lines.push('No obvious practice gaps detected.');
  return lines;
}

function ensureAgentsBlock(root) {
  const marker = '<!-- harness-loop-engineering -->';
  const block = [
    marker,
    '## Harness',
    '',
    'Run `./verify.sh` (edit/turn/commit tiers via flags). Exit codes: 0 pass, 1 fix code, 2 fix harness (never retry 2 as if code is wrong).',
    'Nothing ships (commit/push/PR/deploy) without an explicit developer instruction in the session.',
    '<!-- /harness-loop-engineering -->',
    '',
  ].join('\n');
  const p = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(p)) {
    fs.writeFileSync(
      p,
      [
        '# AGENTS.md',
        '',
        '## Commands',
        '',
        '- `./verify.sh` — default commit-tier checks',
        '- `./verify.sh --edit` — edit tier on changed files',
        '- `./verify.sh --turn` — turn tier',
        '',
        '## Testing',
        '',
        'Prefer the repository test script. Mock I/O at the edges; do not mock the unit under test.',
        '',
        '## Structure',
        '',
        'See `harness/rules/` and service-local AGENTS.md (nearest wins).',
        '',
        '## Style',
        '',
        'Only deltas from Node defaults; linter is source of truth.',
        '',
        '## Git workflow',
        '',
        'Agent may not commit, push, open a PR, or deploy without an explicit instruction.',
        '',
        '## Boundaries',
        '',
        '- Always do: read, lint, unit-test the file you touch.',
        '- Ask first: add dependency, change lockfile, migration, new event type, public route.',
        '- Never touch: production config, credentials, configured infra paths.',
        '',
        block,
      ].join('\n'),
    );
    return;
  }
  const cur = fs.readFileSync(p, 'utf8');
  if (cur.includes(marker)) return;
  fs.writeFileSync(p, cur.trimEnd() + '\n\n' + block);
}

function ensureClaudePointer(root) {
  const p = path.join(root, 'CLAUDE.md');
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '@AGENTS.md\n');
    return;
  }
  const cur = fs.readFileSync(p, 'utf8');
  if (cur.startsWith('@AGENTS.md')) return;
  fs.writeFileSync(p, '@AGENTS.md\n' + cur);
}

function ensureEslintAgentRules(root) {
  const flat = path.join(root, 'eslint.config.js');
  const legacy = path.join(root, '.eslintrc.cjs');
  const snippet = {
    rules: {
      'max-params': ['warn', 4],
      'max-lines': ['warn', 400],
      'max-lines-per-function': ['warn', 80],
      complexity: ['warn', 15],
      'no-process-env': 'error',
    },
    overrides: [
      {
        files: ['**/config/env.js', '**/config/env.mjs', '**/config/env.ts', '**/config/env.cjs'],
        rules: { 'no-process-env': 'off' },
      },
    ],
  };
  // Always write mergeable fragment for teams with existing eslint configs
  const frag = path.join(root, 'harness', 'templates', 'eslint-agent-rules.json');
  fs.mkdirSync(path.dirname(frag), { recursive: true });
  fs.writeFileSync(frag, JSON.stringify(snippet, null, 2) + '\n');

  if (fs.existsSync(flat) || fs.existsSync(legacy)) return;

  fs.writeFileSync(
    legacy,
    `module.exports = ${JSON.stringify(
      { env: { node: true, es2022: true }, rules: snippet.rules, overrides: snippet.overrides },
      null,
      2,
    )};\n`,
  );
}

function installPreCommitHook(root) {
  const hookDir = path.join(root, '.git', 'hooks');
  if (!fs.existsSync(hookDir)) return;
  const hook = path.join(hookDir, 'pre-commit');
  if (fs.existsSync(hook)) {
    const cur = fs.readFileSync(hook, 'utf8');
    if (cur.includes('harness-loop-engineering')) return;
    fs.copyFileSync(hook, `${hook}.bak-harness`);
  }
  fs.writeFileSync(
    hook,
    `#!/usr/bin/env bash
# harness-loop-engineering pre-commit
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
export HARNESS_IN_HOOK=1
"$ROOT/verify.sh" --hook <<'EOF'
{"moment":"pre_commit","agentInitiated":true}
EOF
`,
  );
  fs.chmodSync(hook, 0o755);
}

function countLines(file) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

function commandExists(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf8',
  });
  return r.status === 0;
}
