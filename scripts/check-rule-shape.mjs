#!/usr/bin/env node
/**
 * Enforce the rule structural contract (PRD R0–R4).
 * Exit 0 pass, 1 non-conformant rule, 2 checker cannot run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = process.env.HARNESS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_DIR = path.join(ROOT, 'harness', 'render', 'rules');
const RENDER_DIRS = [
  path.join(ROOT, '.cursor', 'rules'),
  path.join(ROOT, '.claude', 'rules'),
  path.join(ROOT, '.codex', 'rules'),
];

let failures = 0;

function fail(rel, rule, detail) {
  console.error(`${rel}: [${rule}] ${detail}`);
  failures += 1;
}

function stripLeadingComments(text) {
  let s = text;
  for (;;) {
    const next = s.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/^\s+/, '');
}

function parseFrontmatter(text) {
  const trimmed = stripLeadingComments(text);
  if (!trimmed.startsWith('---')) return { error: 'missing YAML frontmatter' };
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return { error: 'unclosed YAML frontmatter' };
  let data;
  try {
    data = parseYaml(trimmed.slice(3, end).trim()) || {};
  } catch (e) {
    return { error: e.message };
  }
  const body = trimmed.slice(end + 4).replace(/^\n/, '');
  return { data, body };
}

function globsNonEmpty(globs) {
  if (globs == null) return false;
  if (typeof globs === 'string') return globs.trim().length > 0;
  if (Array.isArray(globs)) return globs.some((g) => String(g || '').trim().length > 0);
  return false;
}

function sectionBody(body, heading) {
  const re = new RegExp(`^## ${heading}\\s*$`, 'im');
  const m = body.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

function countBullets(text) {
  return text.split('\n').filter((l) => /^\s*-\s+\S/.test(l)).length;
}

function firstParagraphAfterH1(body) {
  const h1 = body.match(/^#\s+.+\s*$/m);
  if (!h1) return { h1: null, paragraph: null };
  const after = body.slice(h1.index + h1[0].length).replace(/^\s*\n/, '');
  const para = after.split(/\n\s*\n/)[0] || '';
  return { h1: h1[0].replace(/^#\s+/, '').trim(), paragraph: para.trim() };
}

function checkFile(abs, rel, { allowPlaceholderDescription = false } = {}) {
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split('\n').length;
  if (lines > 100) fail(rel, 'length', `file has ${lines} lines (max 100)`);

  const parsed = parseFrontmatter(text);
  if (parsed.error) {
    fail(rel, 'frontmatter', parsed.error);
    return;
  }
  const { data, body } = parsed;

  const desc = data.description != null ? String(data.description).trim() : '';
  if (!allowPlaceholderDescription) {
    if (!desc) fail(rel, 'description', 'missing description');
    else if (desc.length > 200) fail(rel, 'description', `description is ${desc.length} chars (max 200)`);
    else if (/^(I|You|We)\s/i.test(desc)) {
      fail(rel, 'description', 'description must be third person (must not start with I/You/We)');
    }
  }

  const hasGlobs = globsNonEmpty(data.globs);
  const always = data.alwaysApply === true;
  if (hasGlobs && always) {
    fail(rel, 'scope', 'globs and alwaysApply: true must not both be set');
  } else if (!hasGlobs && !always) {
    fail(rel, 'scope', 'set non-empty globs or alwaysApply: true');
  }

  const { h1, paragraph } = firstParagraphAfterH1(body);
  if (!h1) fail(rel, 'h1', 'body must open with an H1');
  else if (/\band\b/i.test(h1)) fail(rel, 'h1', 'H1 must not contain "and" (split into separate rules)');

  if (!paragraph) fail(rel, 'ears', 'missing first paragraph after H1');
  else {
    const lower = paragraph.toLowerCase();
    if (!lower.includes('shall')) fail(rel, 'ears', 'first paragraph must contain "shall"');
    if (!lower.includes('because')) fail(rel, 'ears', 'first paragraph must contain "because"');
  }

  const signals = sectionBody(body, 'Signals of violation');
  if (signals == null) fail(rel, 'signals', 'missing "## Signals of violation"');
  else if (countBullets(signals) < 2) {
    fail(rel, 'signals', `need at least 2 bullets, found ${countBullets(signals)}`);
  }

  const how = sectionBody(body, 'How to satisfy it');
  if (how == null) fail(rel, 'satisfy', 'missing "## How to satisfy it"');
  else if (how.length < 20) fail(rel, 'satisfy', 'section must be at least 20 characters');
}

function listRuleFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /\.(md|mdc)$/i.test(n))
    .map((n) => path.join(dir, n))
    .sort();
}

function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`rule-shape: missing ${path.relative(ROOT, SOURCE_DIR)}`);
    process.exit(2);
  }

  const sources = listRuleFiles(SOURCE_DIR);
  if (!sources.length) {
    console.error('rule-shape: no rule files under harness/render/rules/');
    process.exit(2);
  }

  for (const abs of sources) {
    const rel = path.relative(ROOT, abs);
    const base = path.basename(abs);
    checkFile(abs, rel, { allowPlaceholderDescription: false });
  }

  for (const dir of RENDER_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const abs of listRuleFiles(dir)) {
      const rel = path.relative(ROOT, abs);
      checkFile(abs, rel);
    }
  }

  if (failures > 0) {
    console.error(`rule-shape: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('rule-shape: ok');
}

main();
