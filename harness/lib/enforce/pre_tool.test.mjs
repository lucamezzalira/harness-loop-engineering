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

test('A-07 refuses a write on a protected check path without explicitCheckEdit', () => {
  const denied = preTool(root, {
    tool_name: 'Write',
    tool_input: { path: '/repo/harness/sensors/checks/unit.sh', contents: 'echo\n' },
  });
  assert.equal(denied.allow, false);
  assert.match(denied.reason || denied.reasons?.join('\n') || JSON.stringify(denied), /explicitCheckEdit/);

  const allowed = preTool(root, {
    tool_name: 'Write',
    tool_input: { path: '/repo/harness/sensors/checks/unit.sh', contents: 'echo\n' },
    explicitCheckEdit: true,
  });
  assert.equal(allowed.allow, true);
});

test('A-08 refuses shell commands that skip hooks', () => {
  const commands = [
    'git commit --no-verify -m x',
    'HUSKY=0 git commit -m x',
    'HARNESS_IN_HOOK=1 git commit -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git commit -n -m x',
  ];
  for (const command of commands) {
    const r = preTool(root, { tool_name: 'Shell', tool_input: { command } });
    assert.equal(r.allow, false, command);
    assert.match(JSON.stringify(r), /skips hooks/, command);
  }
});
