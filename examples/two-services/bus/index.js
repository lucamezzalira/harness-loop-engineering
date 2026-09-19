/**
 * In-process and file-backed event bus for the example estate.
 */
import fs from 'node:fs';
import path from 'node:path';

export function createInProcessBus() {
  const handlers = new Map();
  return {
    subscribe(type, fn) {
      const list = handlers.get(type) || [];
      list.push(fn);
      handlers.set(type, list);
    },
    async publish(type, payload) {
      for (const fn of handlers.get(type) || []) await fn(payload);
    },
  };
}

export function createFileBus(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const handlers = new Map();
  return {
    subscribe(type, fn) {
      const list = handlers.get(type) || [];
      list.push(fn);
      handlers.set(type, list);
    },
    async publish(type, payload) {
      const file = path.join(dir, `${Date.now()}-${type}.json`);
      fs.writeFileSync(file, JSON.stringify({ type, payload }));
      for (const fn of handlers.get(type) || []) await fn(payload);
    },
  };
}
