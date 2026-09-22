import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DEFAULT_SEVERITY_CATEGORIES, validateSeverityMap } from './severity.mjs';

export const VALID_TOOLS = Object.freeze(['claude', 'cursor', 'codex']);

export const DEFAULTS = Object.freeze({
  project: {
    packageManager: 'npm',
    moduleSystem: 'esm',
    servicesGlob: 'services/*',
    contractsPackage: null,
    infraPaths: ['infra/**'],
  },
  roles: {
    reviewer: { enabled: true },
    'test-writer': { enabled: true },
    security: { enabled: true },
    product: { enabled: true },
    planner: { enabled: true },
    qa: { enabled: false },
    infra: { enabled: false },
  },
  review: {
    maxCycles: 3,
    blockAt: ['P0', 'P1'],
    requireGreen: true,
    cadence: {
      turn: ['reviewer'],
      unit: ['reviewer', 'security', 'product', 'qa'],
    },
    triggers: {
      security: ['services/**/auth/**', '**/log*.js', '**/*secret*'],
      infra: ['infra/**', 'terraform/**'],
      product: ['specs/**'],
    },
  },
  severity: {
    categories: { ...DEFAULT_SEVERITY_CATEGORIES },
    default: 'P2',
  },
  backlog: {
    maxItems: 50,
    expireP3Sessions: 3,
    promoteAfterUnits: 3,
  },
  baseline: {
    agentsMdLines: null,
    duplicatedBlocks: null,
    maxComplexity: null,
  },
  verify: {
    failFast: true,
    maxStopRetries: 2,
    editBudgetMs: 1000,
  },
  logs: {
    enabled: false,
    level: 'events',
    retainSessions: 10,
  },
  limits: {
    agentsMdLines: 200,
    skillBodyLines: 500,
  },
  contexts: [],
  hooks: {
    enable: true,
    failClosed: false,
  },
  loop: {
    prd: 'specs/example-idempotent-consumers/PRD.md',
    maxTurns: null,
    maxSeconds: 1800,
    maxCostUsd: 5.0,
    gate: 'each-unit',
    stopOnIdenticalFailures: 2,
    confirmOnTreeDrift: true,
    splitIfTurnsExceed: 1.5,
  },
});

function deepMerge(a, b) {
  if (!b || typeof b !== 'object') return a;
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof out[k] === 'object' &&
      out[k] &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function readYamlIfExists(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return {};
  return parseYaml(raw) ?? {};
}

/**
 * Precedence: harness.local.yaml > harness.yaml > defaults. No flag layer.
 * @param {string} root
 */
export function loadConfig(root) {
  const shared = readYamlIfExists(path.join(root, 'harness.yaml'));
  const local = readYamlIfExists(path.join(root, 'harness.local.yaml'));
  const modelsPath = path.join(root, 'harness', 'models.yaml');
  const models = fs.existsSync(modelsPath)
    ? readYamlIfExists(modelsPath)
    : { providers: {}, tiers: {}, profiles: {} };

  const config = deepMerge(deepMerge(structuredClone(DEFAULTS), shared), local);
  config._meta = {
    root,
    hasShared: fs.existsSync(path.join(root, 'harness.yaml')),
    hasLocal: fs.existsSync(path.join(root, 'harness.local.yaml')),
    sources: {
      defaults: true,
      harnessYaml: fs.existsSync(path.join(root, 'harness.yaml')),
      harnessLocalYaml: fs.existsSync(path.join(root, 'harness.local.yaml')),
    },
  };
  config.models = models;

  const sev = validateSeverityMap(config.severity);
  if (!sev.ok) {
    const err = new Error(sev.error);
    err.code = 'CONFIG';
    throw err;
  }
  config.severity = sev.map;

  return config;
}

/**
 * tool must be set in harness.local.yaml. No default. Mutual exclusive dirs.
 * @param {object} config
 */
export function requireTool(config) {
  const tool = config.tool;
  if (!tool) {
    const err = new Error(
      [
        'harness.local.yaml is missing `tool`.',
        'Found: no tool field.',
        'Why: adapters and hooks are tool-specific; only one of claude | cursor | codex may be active.',
        'Paste into harness.local.yaml:',
        '',
        'tool: cursor   # or claude | codex',
        'profile: default',
        '',
      ].join('\n'),
    );
    err.code = 'CONFIG';
    err.exitCode = 2;
    throw err;
  }
  if (!VALID_TOOLS.includes(tool)) {
    const err = new Error(
      `tool="${tool}" is invalid. Expected exactly one of: ${VALID_TOOLS.join(', ')}`,
    );
    err.code = 'CONFIG';
    err.exitCode = 2;
    throw err;
  }
  return tool;
}

/**
 * @param {object} config
 * @param {string} roleName
 */
export function resolveRoleBinding(config, roleName) {
  const profileName = config.profile || 'default';
  const profile = config.models?.profiles?.[profileName];
  if (!profile) {
    const err = new Error(
      `profile "${profileName}" not found in harness/models.yaml. Available: ${Object.keys(config.models?.profiles || {}).join(', ') || '(none)'}`,
    );
    err.exitCode = 2;
    throw err;
  }
  const tierName = profile[roleName];
  if (!tierName) return null;
  const tier = config.models.tiers?.[tierName];
  if (!tier) {
    const err = new Error(`tier "${tierName}" for role ${roleName} missing in models.yaml`);
    err.exitCode = 2;
    throw err;
  }
  const provider = config.models.providers?.[tier.provider];
  return {
    role: roleName,
    tier: tierName,
    provider: tier.provider,
    modelId: tier.id,
    providerMeta: provider || { type: 'unknown' },
  };
}

export function formatAssignmentBlock(config) {
  const tool = config.tool || '(unset)';
  const profile = config.profile || 'default';
  const lines = [`Profile: ${profile}                                 tool: ${tool}`, ''];
  const roleNames = ['planner', 'reviewer', 'security', 'product', 'test-writer', 'qa', 'infra'];
  for (const name of roleNames) {
    const enabled = config.roles?.[name]?.enabled !== false;
    if (!enabled) {
      lines.push(`  ${name.padEnd(14)}disabled`);
      continue;
    }
    try {
      const b = resolveRoleBinding(config, name);
      if (!b) {
        lines.push(`  ${name.padEnd(14)}(unbound)`);
        continue;
      }
      const prov =
        b.providerMeta?.type === 'openai-compatible'
          ? `local (${b.providerMeta.baseUrl || 'custom'})`
          : b.provider;
      lines.push(`  ${name.padEnd(14)}${String(b.modelId).padEnd(28)}${prov}`);
    } catch (e) {
      lines.push(`  ${name.padEnd(14)}ERROR: ${e.message}`);
    }
  }
  const turnRoles = config.review?.cadence?.turn || [];
  lines.push('');
  lines.push(`Panel runs ${turnRoles.length} role(s) at end of turn (cadence.turn).`);
  const loop = config.loop || {};
  lines.push(
    `Budget: ${loop.maxTurns ?? '?'} turns · ${Math.round((loop.maxSeconds || 0) / 60)} min · $${Number(loop.maxCostUsd ?? 0).toFixed(2)}`,
  );
  return lines.join('\n');
}

/**
 * Required loop settings with four-part error.
 */
export function assertLoopConfig(config) {
  const missing = [];
  if (!config.loop?.prd) missing.push('loop.prd');
  if (config.loop?.maxTurns == null) missing.push('loop.maxTurns');
  if (missing.length === 0) return;

  const found = JSON.stringify(config.loop || {}, null, 2);
  const why = {
    'loop.prd':
      'Names the PRD the planner and loop work against. Without it the harness cannot know what "done" means.',
    'loop.maxTurns':
      'Hard brake on agent response cycles so a stuck run cannot burn the budget silently.',
  };
  const paste = [
    'loop:',
    '  prd: specs/<slug>/PRD.md',
    '  maxTurns: 20',
    '  maxSeconds: 1800',
    '  maxCostUsd: 5.00',
  ].join('\n');

  const err = new Error(
    [
      `Missing required setting(s): ${missing.join(', ')}`,
      `Found: ${found}`,
      `Why: ${missing.map((m) => why[m] || m).join(' ')}`,
      `Paste into harness.yaml:`,
      '',
      paste,
      '',
    ].join('\n'),
  );
  err.exitCode = 2;
  throw err;
}

export function writeYaml(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringifyYaml(data) + '\n');
}
