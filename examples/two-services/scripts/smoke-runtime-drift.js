#!/usr/bin/env node
/**
 * Smoke for runtime-drift: records HTTP-like edges that have no import.
 * Writes harness/state/traces/calls.json relative to repo root when HARNESS_ROOT set,
 * otherwise examples/two-services/.traces/calls.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInProcessBus } from '../bus/index.js';
import { createOrdersService } from '../services/orders/src/index.js';
import { createBillingService } from '../services/billing/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');

const bus = createInProcessBus();
const orders = createOrdersService({ bus });
createBillingService({ bus });

await orders.confirmOrder({ orderId: 'smoke-1', totalCents: 999 });

// Simulated runtime edge: orders called billing over HTTP (no import).
const edges = [
  {
    from: 'services/orders',
    to: 'services/billing',
    via: 'http',
    inImportGraph: false,
  },
];

const outDir = process.env.HARNESS_ROOT
  ? path.join(process.env.HARNESS_ROOT, 'harness', 'state', 'traces')
  : path.join(exampleRoot, '.traces');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'calls.json'), JSON.stringify({ edges }, null, 2) + '\n');
console.log('wrote', path.join(outDir, 'calls.json'));
console.log('runtime-drift should flag orders → billing HTTP with no import');
