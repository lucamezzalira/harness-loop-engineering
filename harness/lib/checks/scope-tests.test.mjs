import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planScopedTests } from './scope-tests.mjs';

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scope-tests-'));
}

test('empty changed files → full suite', () => {
  const plan = planScopedTests('/tmp', []);
  assert.equal(plan.mode, 'full');
  assert.equal(plan.runs[0].argv[0], 'npm');
});

test('docs-only changes → no tests in scope', () => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, 'specs', 'x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'specs', 'x', 'PRD.md'), '# hi\n');
    const plan = planScopedTests(root, ['specs/x/PRD.md', 'HANDOFF.md']);
    assert.equal(plan.mode, 'none');
    assert.deepEqual(plan.runs, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('examples change → npm test --prefix when package has test script', () => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, 'examples', 'two-services'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'examples', 'two-services', 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test' } }),
    );
    const plan = planScopedTests(root, ['examples/two-services/services/orders/x.js']);
    assert.equal(plan.mode, 'scoped');
    assert.ok(plan.runs.some((r) => r.label === 'examples/two-services'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('harness lib change picks colocated tests', () => {
  const root = makeRoot();
  try {
    const dir = path.join(root, 'harness', 'lib', 'checks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'scope-tests.mjs'), 'export {}\n');
    fs.writeFileSync(path.join(dir, 'scope-tests.test.mjs'), 'import test from "node:test";\n');
    const plan = planScopedTests(root, ['harness/lib/checks/scope-tests.mjs']);
    assert.equal(plan.mode, 'scoped');
    const nodeRun = plan.runs.find((r) => r.label === 'node-test');
    assert.ok(nodeRun);
    assert.ok(nodeRun.argv.includes('harness/lib/checks/scope-tests.test.mjs'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('services package without test script and no tests → none', () => {
  const root = makeRoot();
  try {
    fs.mkdirSync(path.join(root, 'services', 'orders', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'services', 'orders', 'package.json'),
      JSON.stringify({ name: 'orders' }),
    );
    fs.writeFileSync(path.join(root, 'services', 'orders', 'src', 'index.js'), 'export {}\n');
    const plan = planScopedTests(root, ['services/orders/src/index.js']);
    assert.equal(plan.mode, 'none');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
