import path from 'node:path';

const WRITE_TOOLS = new Set([
  'write',
  'edit',
  'strreplace',
  'search_replace',
  'apply_patch',
  'delete',
  'notebookedit',
  'editnotebook',
]);

/**
 * Before a tool call. Can refuse.
 *
 * Guards apply to shell commands and write-like tools only.
 * Read / grep / glob / semantic search must never be blocked for path location:
 * that wedged Cursor when failClosed was on (skills and MCP paths live outside the repo).
 */
export function preTool(root, payload) {
  const toolName = String(payload.tool_name || payload.toolName || payload.name || '');
  const toolKey = toolName.toLowerCase().replace(/[^a-z]/g, '');
  const input = payload.tool_input || payload.input || payload || {};
  const command = String(input.command || input.cmd || '');
  const filePath = String(
    input.file_path || input.path || input.filePath || input.target_notebook || '',
  );

  const reasons = [];
  const isShell = isShellTool(toolKey, command);
  const isWrite = WRITE_TOOLS.has(toolKey) || toolKey.includes('write') || toolKey.includes('edit');

  if (isShell) {
    if (
      /rm\s+(-[^\s]*f[^\s]*\s+.*-r|-r[^\s]*\s+.*-f|-[^\s]*rf|-rf)/.test(command) ||
      /rm\s+-rf\b/.test(command)
    ) {
      reasons.push('refused: rm -rf is not allowed');
    }
    if (/git\s+push\b.*(--force|-f)\b/.test(command) || /git\s+push\s+-f\b/.test(command)) {
      reasons.push('refused: force push is not allowed');
    }
    if (/git\s+commit\b/.test(command) && !payload.explicitShipInstruction) {
      reasons.push(
        'refused: agent-initiated commit. Commit requires an explicit developer instruction in this session (ship gate).',
      );
    }
    if (/git\s+push\b/.test(command) && !payload.explicitShipInstruction) {
      reasons.push('refused: push requires an explicit developer instruction in this session');
    }
    if (/\bgh\s+pr\s+create\b/.test(command) && !payload.explicitShipInstruction) {
      reasons.push('refused: pull request requires an explicit developer instruction in this session');
    }
    if (
      /\b(terraform\s+apply|pulumi\s+up|fly\s+deploy|kubectl\s+apply)\b/.test(command) &&
      !payload.explicitShipInstruction
    ) {
      reasons.push('refused: deploy requires an explicit developer instruction in this session');
    }
  }

  // Path rules only for write-like tools (never for Read/Grep/…).
  if (isWrite && filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
    const rel = path.relative(root, abs).replace(/\\/g, '/');

    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      reasons.push(`refused: write outside tree (${filePath})`);
    } else if (isGeneratedAdapterPath(rel)) {
      // Always allow hooks.json so a wedged adapter can be cleared without leaving the IDE.
      if (rel.endsWith('hooks.json') || rel.endsWith('hooks.env.md')) {
        /* recovery / render output — allow */
      } else if (!payload.allowAdapterEdit) {
        reasons.push(
          `refused: generated adapter path ${rel} — use ./verify.sh --render (or edit hooks.json only to recover)`,
        );
      }
    }
  }

  if (reasons.length) {
    return { allow: false, reasons };
  }
  return { allow: true, reasons: [] };
}

function isShellTool(toolKey, command) {
  if (command) return true;
  return toolKey === 'shell' || toolKey === 'bash' || toolKey === 'terminal' || toolKey.includes('shell');
}

function isGeneratedAdapterPath(rel) {
  return (
    rel.startsWith('.cursor/') ||
    rel.startsWith('.claude/') ||
    rel.startsWith('.codex/')
  );
}
