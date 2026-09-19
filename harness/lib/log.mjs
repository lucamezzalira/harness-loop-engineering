import fs from 'node:fs';
import path from 'node:path';

function redact(text) {
  let s = String(text);
  s = s.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[\w.-]+/gi, '$1=[REDACTED]');
  s = s.replace(/sk-[a-zA-Z0-9]{10,}/g, '[REDACTED]');
  s = s.replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]');
  return s;
}

/**
 * @param {string} root
 * @param {object} config
 * @param {string} sessionId
 */
export function createLogger(root, config, sessionId) {
  const enabled = Boolean(config.logs?.enabled);
  const level = config.logs?.level || 'events';
  const dir = path.join(root, 'harness', 'state', 'logs', sessionId);
  const file = path.join(dir, 'events.ndjson');

  function write(event) {
    if (!enabled && event.type !== 'session_start' && event.type !== 'stop') {
      // still write minimal lifecycle when logs off? PRD says off by default.
      // Only write when enabled, except we always want crash-safe session markers if enabled.
      return;
    }
    if (!enabled) return;
    fs.mkdirSync(dir, { recursive: true });
    const line = redact(JSON.stringify({ ts: new Date().toISOString(), sessionId, ...event }));
    fs.appendFileSync(file, line + '\n');
  }

  function rotate(retain) {
    const base = path.join(root, 'harness', 'state', 'logs');
    if (!fs.existsSync(base)) return;
    const sessions = fs
      .readdirSync(base)
      .filter((n) => fs.statSync(path.join(base, n)).isDirectory())
      .map((n) => ({ n, m: fs.statSync(path.join(base, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const extra of sessions.slice(retain || 10)) {
      fs.rmSync(path.join(base, extra.n), { recursive: true, force: true });
    }
  }

  return {
    enabled,
    level,
    file,
    write,
    rotate,
    /**
     * @param {object} event
     * @param {string} [source]
     * @param {string} [prompt]
     */
    event(event, source, prompt) {
      const payload = { ...event };
      if (level === 'full') {
        if (source) payload.source = redact(source);
        if (prompt) payload.prompt = redact(prompt);
      }
      write(payload);
    },
  };
}

export function newSessionId() {
  return Math.random().toString(16).slice(2, 8) + Date.now().toString(16).slice(-4);
}
