#!/usr/bin/env node
/**
 * Validate ADR frontmatter and supersession link integrity.
 * Exit 0 pass, 2 harness-wrong.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = process.env.HARNESS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADR_DIR = path.join(ROOT, 'docs', 'adr');
const STATUSES = new Set(['proposed', 'accepted', 'deprecated', 'superseded']);
const REQUIRED = [
  'id',
  'title',
  'status',
  'date',
  'tags',
  'touches',
  'supersedes',
  'superseded-by',
];

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

function asList(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

function parseFrontmatter(rel, text) {
  if (!text.startsWith('---')) fail(`${rel}: missing YAML frontmatter`);
  const end = text.indexOf('\n---', 3);
  if (end < 0) fail(`${rel}: unclosed YAML frontmatter`);
  try {
    return parseYaml(text.slice(3, end).trim()) || {};
  } catch (e) {
    fail(`${rel}: ${e.message}`);
  }
}

function looksLikeGlob(s) {
  return typeof s === 'string' && (s.includes('/') || s.includes('*'));
}

function main() {
  if (!fs.existsSync(ADR_DIR)) {
    console.log('no docs/adr/; skip');
    return;
  }
  const files = fs
    .readdirSync(ADR_DIR)
    .filter((n) => /^\d{4}-.+\.md$/.test(n))
    .sort();
  if (!files.length) {
    console.log('no ADRs');
    return;
  }

  const byId = new Map();
  const records = [];

  for (const name of files) {
    const rel = path.join('docs/adr', name);
    const data = parseFrontmatter(rel, fs.readFileSync(path.join(ADR_DIR, name), 'utf8'));
    for (const k of REQUIRED) {
      if (!(k in data)) fail(`${rel}: missing required field "${k}"`);
    }
    const idRaw = String(data.id);
    if (!/^\d{4}$/.test(idRaw)) {
      fail(`${rel}: id must be four-digit zero-padded, got "${data.id}"`);
    }
    if (name.slice(0, 4) !== idRaw) {
      fail(`${rel}: id "${idRaw}" does not match filename prefix`);
    }
    if (!STATUSES.has(data.status)) {
      fail(
        `${rel}: status must be one of ${[...STATUSES].join(', ')}, got "${data.status}"`,
      );
    }
    const touches = asList(data.touches);
    if (!touches.length) fail(`${rel}: touches must be a non-empty list`);
    for (const t of touches) {
      if (!looksLikeGlob(t)) {
        fail(`${rel}: touches entry "${t}" must look like a path glob (contain / or *)`);
      }
    }
    if (byId.has(idRaw)) fail(`duplicate id ${idRaw}: ${byId.get(idRaw)} and ${rel}`);
    byId.set(idRaw, rel);
    records.push({
      rel,
      id: idRaw,
      status: data.status,
      supersedes: asList(data.supersedes).map((x) => String(x).padStart(4, '0')),
      supersededBy: data['superseded-by'] ? String(data['superseded-by']).padStart(4, '0') : '',
    });
  }

  for (const r of records) {
    if (r.status === 'superseded') {
      if (!r.supersededBy) fail(`${r.rel}: status superseded requires superseded-by`);
      if (!byId.has(r.supersededBy)) {
        fail(`${r.rel}: superseded-by ${r.supersededBy} does not exist`);
      }
    }
    for (const old of r.supersedes) {
      if (!byId.has(old)) fail(`${r.rel}: supersedes ${old} does not exist`);
      const target = records.find((x) => x.id === old);
      if (target.supersededBy !== r.id) {
        fail(
          `${r.rel}: supersedes ${old} but ${target.rel} has superseded-by "${target.supersededBy || '(empty)'}" (expected ${r.id})`,
        );
      }
    }
    if (r.supersededBy) {
      const newer = records.find((x) => x.id === r.supersededBy);
      if (!newer) fail(`${r.rel}: superseded-by ${r.supersededBy} missing`);
      if (!newer.supersedes.includes(r.id)) {
        fail(
          `${r.rel}: superseded-by ${r.supersededBy} but ${newer.rel} does not list ${r.id} in supersedes`,
        );
      }
    }
  }

  console.log(`adr-frontmatter ok (${records.length} ADRs)`);
}

main();
