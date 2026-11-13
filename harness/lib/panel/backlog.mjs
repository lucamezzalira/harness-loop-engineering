import fs from 'node:fs';
import path from 'node:path';
import { readSession, writeSession } from '../accounting.mjs';
import { newAdhocSession } from '../enforce/adhoc-session.mjs';
import { isTTY, prompt } from '../tty.mjs';

function backlogPath(root) {
  return path.join(root, 'harness', 'state', 'backlog.json');
}

export function readBacklog(root) {
  const p = backlogPath(root);
  if (!fs.existsSync(p)) return { items: [], categoryHits: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeBacklog(root, data) {
  fs.mkdirSync(path.dirname(backlogPath(root)), { recursive: true });
  fs.writeFileSync(backlogPath(root), JSON.stringify(data, null, 2) + '\n');
}

/**
 * Append P2/P3. Cap at maxItems (oldest discarded first). Track categories per unit.
 */
export function appendBacklog(root, config, findings, unitId) {
  const data = readBacklog(root);
  const max = config.backlog?.maxItems ?? 50;
  const session = data.session || 0;

  for (const f of findings) {
    // skip if identical already present unless severity changed
    const existing = data.items.find(
      (i) =>
        i.file === f.file &&
        i.line === f.line &&
        i.category === f.category &&
        i.message === f.message,
    );
    if (existing) {
      if (existing.severity !== f.severity) existing.severity = f.severity;
      continue;
    }
    data.items.push({
      ...f,
      unitId: unitId || null,
      session,
      addedAt: new Date().toISOString(),
    });
    if (f.category && unitId) {
      data.categoryHits[f.category] = data.categoryHits[f.category] || [];
      if (!data.categoryHits[f.category].includes(unitId)) {
        data.categoryHits[f.category].push(unitId);
      }
    }
  }

  while (data.items.length > max) data.items.shift();
  writeBacklog(root, data);
  return data;
}

/**
 * Expire P3 after expireP3Sessions sessions.
 */
export function expireBacklog(root, config) {
  const data = readBacklog(root);
  const expire = config.backlog?.expireP3Sessions ?? 3;
  data.session = (data.session || 0) + 1;
  data.items = data.items.filter((i) => {
    if (i.severity !== 'P3') return true;
    return data.session - (i.session || 0) < expire;
  });
  writeBacklog(root, data);
  return data;
}

/**
 * Promote categories seen across promoteAfterUnits to proposed-rules.md
 */
export function promoteRecurring(root, config) {
  const data = readBacklog(root);
  const after = config.backlog?.promoteAfterUnits ?? 3;
  const proposed = [];
  for (const [cat, units] of Object.entries(data.categoryHits || {})) {
    if (units.length >= after) {
      proposed.push({
        category: cat,
        units,
        suggestion: `Recurring category "${cat}" across ${units.length} units. Consider a guide/rule in harness/render/rules/.`,
      });
    }
  }
  if (!proposed.length) return null;
  const out = path.join(root, 'harness', 'state', 'proposed-rules.md');
  const body =
    '# Proposed rules\n\nCategories that recur across units become missing guides.\n\n' +
    proposed.map((p) => `- **${p.category}** (${p.units.join(', ')}): ${p.suggestion}`).join('\n') +
    '\n';
  fs.writeFileSync(out, body);
  return out;
}

function slugFor(item) {
  const raw = `${item.role || 'finding'}-${item.category || 'note'}-${item.line || 0}`;
  return (
    String(raw)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'promoted-finding'
  );
}

function writeSpecStub(root, item) {
  const slug = slugFor(item);
  const dir = path.join(root, 'specs', slug);
  fs.mkdirSync(dir, { recursive: true });
  const prd = path.join(dir, 'PRD.md');
  if (!fs.existsSync(prd)) {
    fs.writeFileSync(
      prd,
      `# ${slug}\n\nPromoted from ${item.role || '?'}: ${item.message || ''}\n`,
    );
  }
  const acc = path.join(dir, 'acceptance.json');
  if (!fs.existsSync(acc)) {
    fs.writeFileSync(acc, JSON.stringify({ entries: [] }, null, 2) + '\n');
  }
  return slug;
}

/**
 * On a TTY, keep / discard / promote one finding at a time.
 * Without a TTY, print the same list as before.
 */
export async function triageBacklog(root, io = {}) {
  const interactive = io.isTTY ? io.isTTY() : isTTY();
  if (!interactive || process.env.HARNESS_IN_HOOK === '1') {
    return { exitCode: 0, text: renderBacklog(root) };
  }
  const data = readBacklog(root);
  const ask = io.ask || ((q) => prompt(q, { defaultAnswer: 'keep', nonInteractive: 'keep' }));
  const session = readSession(root) || newAdhocSession(root, io.env || process.env);
  session.dismissedByRole = session.dismissedByRole || {};
  for (const item of data.items) {
    if (item.outcome === 'dismissed' || item.outcome === 'promoted' || item.outcome === 'fixed') {
      continue;
    }
    const answer = String(
      (await ask(
        `[${item.severity}] ${item.role || '?'} ${item.file || ''}:${item.line ?? ''} ${item.message || ''}\nkeep, discard, or promote? `,
      )) || 'keep',
    )
      .trim()
      .toLowerCase();
    if (answer.startsWith('d')) {
      item.outcome = 'dismissed';
      const role = item.role || '?';
      session.dismissedByRole[role] = (session.dismissedByRole[role] || 0) + 1;
    } else if (answer.startsWith('p')) {
      item.outcome = 'promoted';
      item.promotedSlug = writeSpecStub(root, item);
    } else {
      item.outcome = 'open';
    }
  }
  writeBacklog(root, data);
  session.reviewFindings = data.items.map((item) => ({ ...item }));
  writeSession(root, session);
  return { exitCode: 0, text: renderBacklog(root), session };
}

export function renderBacklog(root) {
  const data = readBacklog(root);
  if (!data.items.length) return 'Backlog is empty.\n';
  const lines = ['Backlog (P2 and below) — triage: keep, discard, or promote to a spec', ''];
  for (const i of data.items) {
    lines.push(
      `- [${i.severity}] ${i.role || '?'} ${i.file || ''}:${i.line ?? ''}  ${i.message || ''}  (${i.category})`,
    );
  }
  return lines.join('\n') + '\n';
}
