import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} root
 * @param {object} report
 */
export function writeReport(root, report) {
  const dir = path.join(root, 'harness', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  return out;
}

/**
 * @param {string} root
 */
export function readReport(root) {
  const p = path.join(root, 'harness', 'state', 'report.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
