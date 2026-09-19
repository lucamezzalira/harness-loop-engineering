import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export function isTTY() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Interactive: ask. Non-interactive: return defaultAnswer (never hang).
 * @param {string} question
 * @param {{ defaultAnswer?: string, nonInteractive?: string }} opts
 */
export async function prompt(question, opts = {}) {
  const { defaultAnswer = 'n', nonInteractive } = opts;
  if (!isTTY()) {
    if (nonInteractive !== undefined) return nonInteractive;
    return defaultAnswer;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => {
      rl.question(question, resolve);
    });
    return String(answer || '').trim() || defaultAnswer;
  } finally {
    rl.close();
  }
}

/**
 * Ship gate: commit/push/PR/deploy. Non-interactive always refuses.
 * @param {string} action
 */
export async function requireExplicitShipInstruction(action) {
  if (!isTTY()) {
    return {
      allowed: false,
      reason: `${action} refused: non-interactive session. Nothing ships without an explicit instruction in this session.`,
    };
  }
  const answer = await prompt(`Explicit instruction required to ${action}. Type YES to proceed: `, {
    defaultAnswer: '',
    nonInteractive: '',
  });
  if (answer === 'YES') {
    return { allowed: true, reason: `developer confirmed ${action}` };
  }
  return {
    allowed: false,
    reason: `${action} refused: no explicit YES from developer in this session`,
  };
}

/**
 * Profile confirmation. Non-interactive: skipped (caller logs resolved assignment).
 */
export async function confirmProfile(message) {
  if (!isTTY()) {
    return { confirmed: true, skipped: true, reason: 'non-TTY: profile confirmation skipped' };
  }
  const answer = await prompt(`${message}\nProceed? [y/N] `, {
    defaultAnswer: 'n',
    nonInteractive: 'y',
  });
  const ok = /^y(es)?$/i.test(answer);
  return { confirmed: ok, skipped: false, reason: ok ? 'confirmed' : 'declined' };
}

/**
 * Split recommendation. Non-interactive: record and proceed.
 */
export async function confirmSplit(message) {
  if (!isTTY()) {
    return {
      split: false,
      proceed: true,
      skipped: true,
      reason: 'non-TTY: recorded recommendation, proceeding',
    };
  }
  const answer = await prompt(`${message}\nSplit unit? [y/N] `, {
    defaultAnswer: 'n',
    nonInteractive: 'n',
  });
  return {
    split: /^y(es)?$/i.test(answer),
    proceed: true,
    skipped: false,
    reason: 'interactive',
  };
}

/**
 * Tool selection for --install. Non-interactive: detect from dirs or exit 2.
 * @param {string} root
 */
export function detectToolFromDirs(root) {
  const markers = [
    ['.cursor', 'cursor'],
    ['.claude', 'claude'],
    ['.codex', 'codex'],
  ];
  for (const [dir, tool] of markers) {
    if (fs.existsSync(path.join(root, dir))) return tool;
  }
  return null;
}
