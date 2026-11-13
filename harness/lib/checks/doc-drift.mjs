import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

/**
 * Docs stay aligned with the flags, sensors, roles, skills, and config keys
 * the harness actually has. Relative links in tracked markdown must resolve.
 * @param {string} root
 * @returns {{ exitCode: number, findings: string[] }}
 */
export function evaluateDocDrift(root) {
  const findings = [
    ...flagFindings(root),
    ...sensorFindings(root),
    ...roleFindings(root),
    ...skillFindings(root),
    ...configKeyFindings(root),
    ...linkFindings(root),
  ];
  return { exitCode: findings.length ? 1 : 0, findings };
}

function flagFindings(root) {
  const cliPath = path.join(root, 'harness', 'lib', 'cli.mjs');
  if (!fs.existsSync(cliPath)) return [];
  const cli = fs.readFileSync(cliPath, 'utf8');
  const flags = flagsIn(cli);
  const readme = readIf(path.join(root, 'README.md'));
  const commands = section(readme, '## Commands');
  const findings = [];
  for (const flag of flags) {
    if (!commands.includes(flag)) {
      findings.push(
        `flag ${flag} is accepted by cli.mjs and missing from the README commands table`,
      );
    }
  }
  return findings;
}

function sensorFindings(root) {
  const yamlPath = path.join(root, 'harness', 'sensors', 'sensors.yaml');
  if (!fs.existsSync(yamlPath)) return [];
  const doc = parseYaml(fs.readFileSync(yamlPath, 'utf8')) || {};
  const readme = readIf(path.join(root, 'README.md'));
  const findings = [];
  for (const sensor of doc.sensors || []) {
    const name = String(sensor?.name || '');
    if (!name) continue;
    const guidance = path.join(root, 'harness', 'sensors', 'guidance', `${name}.md`);
    if (!fs.existsSync(guidance)) {
      findings.push(`sensor ${name} has no guidance/${name}.md`);
    }
    if (!mentions(readme, name)) {
      findings.push(`sensor ${name} is not mentioned in the README`);
    }
  }
  return findings;
}

function roleFindings(root) {
  const yamlPath = path.join(root, 'harness.yaml');
  if (!fs.existsSync(yamlPath)) return [];
  const doc = parseYaml(fs.readFileSync(yamlPath, 'utf8')) || {};
  const readme = readIf(path.join(root, 'harness', 'roles', 'README.md'));
  const findings = [];
  for (const [name, spec] of Object.entries(doc.roles || {})) {
    if (!spec || spec.enabled !== true) continue;
    if (!mentions(readme, name)) {
      findings.push(`enabled role ${name} has no row in harness/roles/README.md`);
    }
  }
  return findings;
}

function skillFindings(root) {
  const dir = path.join(root, 'harness', 'skills');
  if (!fs.existsSync(dir)) return [];
  const readme = readIf(path.join(root, 'README.md'));
  const findings = [];
  for (const name of fs.readdirSync(dir)) {
    const skill = path.join(dir, name);
    if (!fs.statSync(skill).isDirectory()) continue;
    if (!mentions(readme, name)) {
      findings.push(`skill ${name} is not listed in the README`);
    }
  }
  return findings;
}

function configKeyFindings(root) {
  const yamlPath = path.join(root, 'harness.yaml');
  if (!fs.existsSync(yamlPath)) return [];
  const doc = parseYaml(fs.readFileSync(yamlPath, 'utf8')) || {};
  const config = section(readIf(path.join(root, 'README.md')), '## Configuration');
  const findings = [];
  for (const key of Object.keys(doc)) {
    if (!mentions(config, key)) {
      findings.push(`harness.yaml key ${key} is not described in the README configuration section`);
    }
  }
  return findings;
}

function linkFindings(root) {
  const findings = [];
  for (const rel of trackedMarkdown(root)) {
    const text = readIf(path.join(root, rel));
    for (const target of markdownTargets(text)) {
      if (skips(target)) continue;
      const bare = target.split('#')[0];
      if (!bare) continue;
      const abs = path.resolve(path.dirname(path.join(root, rel)), bare);
      if (!fs.existsSync(abs)) {
        findings.push(`${rel} links to missing path ${target}`);
      }
    }
  }
  return findings;
}

function flagsIn(cli) {
  const start = cli.indexOf('const ACTION_FLAGS');
  const end = start < 0 ? -1 : cli.indexOf(']);', start);
  const block = start < 0 || end < 0 ? '' : cli.slice(start, end);
  const flags = [];
  for (const match of block.matchAll(/'([^']+)'/g)) flags.push(match[1]);
  if (cli.includes("'--check'") && !flags.includes('--check')) flags.push('--check');
  return flags;
}

function section(markdown, heading) {
  const at = markdown.indexOf(heading);
  if (at < 0) return '';
  const rest = markdown.slice(at + heading.length);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

function mentions(text, name) {
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(name, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + name.length] || '';
    if (isBoundary(before) && isBoundary(after)) return true;
    from = at + name.length;
  }
  return false;
}

function isBoundary(ch) {
  return !ch || !/[A-Za-z0-9_-]/.test(ch);
}

function markdownTargets(text) {
  const out = [];
  for (const match of text.matchAll(LINK)) out.push(match[1]);
  return out;
}

function skips(target) {
  return (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('#')
  );
}

function trackedMarkdown(root) {
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (listed.status !== 0) return [];
  return listed.stdout.split('\0').filter((rel) => rel.endsWith('.md'));
}

function readIf(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const root = process.env.HARNESS_ROOT || process.cwd();
  const result = evaluateDocDrift(root);
  if (result.exitCode !== 0) {
    for (const line of result.findings) console.error(line);
  } else {
    console.log('doc-drift ok');
  }
  process.exit(result.exitCode);
}
