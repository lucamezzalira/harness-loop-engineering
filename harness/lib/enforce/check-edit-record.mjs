import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Live window for a developer check-edit authorisation. */
export const CHECK_EDIT_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * @param {{ at?: string, paths?: string[], sessionId?: string } | null | undefined} record
 * @param {{ now?: number, sessionId?: string }} [opts]
 */
export function recordIsLive(record, { now = Date.now(), sessionId } = {}) {
  if (!record || !record.at || !Array.isArray(record.paths) || !record.paths.length) return false;
  if (!record.sessionId || (sessionId && record.sessionId !== sessionId)) return false;
  const at = Date.parse(record.at);
  if (!Number.isFinite(at)) return false;
  if (now - at > CHECK_EDIT_TTL_MS) return false;
  return true;
}

/**
 * Canonical hash of the fields the developer recorded.
 * The stored copy is the last field of check-edits.log, not a field the
 * session file can vouch for on its own.
 * @param {{ paths?: string[], reason?: string, at?: string, by?: string, sessionId?: string }} record
 */
export function hashRecord(record) {
  const body = JSON.stringify({
    at: record?.at || '',
    by: record?.by || '',
    paths: Array.isArray(record?.paths) ? record.paths : [],
    reason: record?.reason || '',
    sessionId: record?.sessionId || '',
  });
  return createHash('sha256').update(body).digest('hex');
}

/**
 * @param {{ paths?: string[], reason?: string, at?: string, by?: string, sessionId?: string }} record
 */
export function checkEditLogLine(record) {
  const reason = String(record?.reason || '').replace(/[\r\n\t]/g, ' ');
  const paths = Array.isArray(record?.paths) ? record.paths.join(',') : '';
  return `${record?.at || ''}\t${record?.by || ''}\t${record?.sessionId || ''}\t${paths}\t${reason}\t${hashRecord(record)}\n`;
}

/**
 * @param {string} root
 */
export function readCheckEditLog(root) {
  try {
    return fs.readFileSync(path.join(root, 'harness', 'state', 'check-edits.log'), 'utf8');
  } catch {
    return '';
  }
}

/**
 * @param {{ paths?: string[], reason?: string, at?: string, by?: string, sessionId?: string } | null | undefined} record
 * @param {string} logText
 */
export function recordMatchesLog(record, logText) {
  if (!record) return false;
  const lines = String(logText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  const last = lines[lines.length - 1].split('\t').pop();
  return last === hashRecord(record);
}

export function liveCheckEdits(session, now = Date.now(), logText = '') {
  const record = session?.explicitCheckEdit;
  if (!recordIsLive(record, { now, sessionId: session?.id })) return [];
  if (!recordMatchesLog(record, logText)) return [];
  return [record];
}

export function clearCheckEdit(session) {
  if (session) delete session.explicitCheckEdit;
}
