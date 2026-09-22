#!/usr/bin/env node
/**
 * session-state — local-only consistency of harness/state vs HANDOFF.md.
 * Exit 0 ok, 1 interrupted session, 2 harness-wrong (missing/unwritable state).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.HARNESS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, 'harness', 'state');

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

if (!fs.existsSync(STATE_DIR) || !fs.statSync(STATE_DIR).isDirectory()) {
  fail(2, 'harness/state/ missing; run ./verify.sh --install to create it');
}

try {
  fs.accessSync(STATE_DIR, fs.constants.W_OK);
} catch {
  fail(2, 'harness/state/ is not writable by the current user');
}

const handoff = path.join(ROOT, 'HANDOFF.md');
if (fs.existsSync(handoff)) {
  const text = fs.readFileSync(handoff, 'utf8');
  const hasEntries = /^##\s+/m.test(text);
  if (hasEntries) {
    const markers = ['session.json', 'report.json', 'plan.json'];
    const hasMarker = markers.some((f) => fs.existsSync(path.join(STATE_DIR, f)));
    const logsDir = path.join(STATE_DIR, 'logs');
    const hasLogs =
      fs.existsSync(logsDir) &&
      fs.readdirSync(logsDir).some((n) => {
        try {
          return fs.statSync(path.join(logsDir, n)).isDirectory();
        } catch {
          return false;
        }
      });
    if (!hasMarker && !hasLogs) {
      fail(
        1,
        'HANDOFF.md exists but no session records found in harness/state/\n' +
          'Previous session may have been interrupted; verify before continuing',
      );
    }
  }
}

console.log('session-state ok');
