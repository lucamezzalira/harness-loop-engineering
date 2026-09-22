#!/usr/bin/env node
/**
 * Bounded-context diff scope: fail if a diff spans 2+ contexts without an ADR.
 * Exit 0 pass / skip, 1 code-wrong, 2 harness-wrong (bad config).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HARNESS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadContexts() {
  let config = {};
  try {
    config = JSON.parse(process.env.HARNESS_CONFIG_JSON || '{}');
  } catch {
    console.error('diff-scope: HARNESS_CONFIG_JSON is not valid JSON');
    process.exit(2);
  }
  const contexts = config.contexts;
  if (!contexts || !Array.isArray(contexts) || contexts.length === 0) {
    console.log('diff-scope: no contexts configured; skip');
    process.exit(0);
  }
  for (const c of contexts) {
    if (typeof c !== 'string' || !c.trim()) {
      console.error('diff-scope: contexts entries must be non-empty path prefixes');
      process.exit(2);
    }
  }
  return contexts.map((c) => c.replace(/\/$/, ''));
}

function changedFiles() {
  const base = process.env.HARNESS_DIFF_BASE || 'HEAD';
  const r = spawnSync('git', ['diff', '--name-only', base], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const staged = spawnSync('git', ['diff', '--name-only', '--cached'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const set = new Set(
    [...(r.stdout || '').split('\n'), ...(staged.stdout || '').split('\n'), ...(untracked.stdout || '').split('\n')]
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return [...set];
}

function contextFor(file, contexts) {
  const hits = contexts.filter((c) => file === c || file.startsWith(`${c}/`));
  if (!hits.length) return null;
  // longest prefix wins
  return hits.sort((a, b) => b.length - a.length)[0];
}

function main() {
  const contexts = loadContexts();
  const files = changedFiles();
  const hit = new Map();
  let adrInDiff = false;
  for (const f of files) {
    if (/^docs\/adr\/\d{4}-.+\.md$/.test(f)) adrInDiff = true;
    const c = contextFor(f, contexts);
    if (!c) continue;
    if (!hit.has(c)) hit.set(c, []);
    hit.get(c).push(f);
  }
  if (hit.size <= 1) {
    console.log(`diff-scope ok (contexts touched: ${hit.size})`);
    process.exit(0);
  }
  const names = [...hit.keys()].join(', ');
  if (!adrInDiff) {
    console.error(
      `diff touches ${hit.size} contexts (${names}) without a new or changed docs/adr/NNNN-*.md.\n` +
        `Split the change or add an ADR that justifies the cross-context work.`,
    );
    for (const [c, fs_] of hit) {
      console.error(`  ${c}: ${fs_.slice(0, 5).join(', ')}${fs_.length > 5 ? '…' : ''}`);
    }
    process.exit(1);
  }
  console.log(
    `diff-scope: ${hit.size} contexts (${names}) with ADR in diff.\n` +
      `P2 note: reviewer should confirm the ADR justifies the cross-context change.`,
  );
  process.exit(0);
}

main();
