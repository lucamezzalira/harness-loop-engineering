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

export function liveCheckEdits(session, now = Date.now()) {
  const record = session?.explicitCheckEdit;
  if (!recordIsLive(record, { now, sessionId: session?.id })) return [];
  return [record];
}

export function clearCheckEdit(session) {
  if (session) delete session.explicitCheckEdit;
}
