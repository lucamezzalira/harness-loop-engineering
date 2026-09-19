import test from 'node:test';
import assert from 'node:assert/strict';
import { preTool } from './pre_tool.mjs';

const root = '/repo';

test('allows Read outside the tree', () => {
  const r = preTool(root, {
    tool_name: 'Read',
    tool_input: { path: '/Users/me/.cursor/skills-cursor/foo.md' },
  });
  assert.equal(r.allow, true);
});

test('blocks write outside the tree', () => {
  const r = preTool(root, {
    tool_name: 'Write',
    tool_input: { path: '/tmp/x.js', contents: 'x' },
  });
  assert.equal(r.allow, false);
});

test('allows clearing hooks.json for recovery', () => {
  const r = preTool(root, {
    tool_name: 'Write',
    tool_input: { path: '/repo/.cursor/hooks.json', contents: '{}' },
  });
  assert.equal(r.allow, true);
});

test('blocks write to generated agent role file', () => {
  const r = preTool(root, {
    tool_name: 'Write',
    tool_input: { path: '/repo/.cursor/agents/reviewer.md', contents: 'x' },
  });
  assert.equal(r.allow, false);
});

test('blocks rm -rf and force push', () => {
  assert.equal(
    preTool(root, { tool_name: 'Shell', tool_input: { command: 'rm -rf /' } }).allow,
    false,
  );
  assert.equal(
    preTool(root, { tool_name: 'Shell', tool_input: { command: 'git push --force' } }).allow,
    false,
  );
});

test('ship gate blocks agent commit', () => {
  const r = preTool(root, {
    tool_name: 'Shell',
    tool_input: { command: 'git commit -m x' },
  });
  assert.equal(r.allow, false);
});
