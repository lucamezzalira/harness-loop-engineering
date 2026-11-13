import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A spec whose acceptance entries all pass needs a REPORT.md that ends
 * with an acceptance-checker PASS line.
 * @param {string} root
 * @returns {{ exitCode: number, findings: string[] }}
 */
export function evaluateReportPresent(root) {
  const specs = path.join(root, 'specs');
  const findings = [];
  if (!fs.existsSync(specs)) return { exitCode: 0, findings };
  for (const slug of fs.readdirSync(specs)) {
    const dir = path.join(specs, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    const accPath = path.join(dir, 'acceptance.json');
    if (!fs.existsSync(accPath)) continue;
    const entries = acceptanceEntries(accPath);
    if (!entries.length || !entries.every((entry) => entry && entry.passes === true)) continue;
    const reportPath = path.join(dir, 'REPORT.md');
    if (!fs.existsSync(reportPath)) {
      findings.push(`${slug}: acceptance.json is all passing and REPORT.md is missing`);
      continue;
    }
    const text = fs.readFileSync(reportPath, 'utf8').trim();
    if (!text.endsWith('acceptance-checker: PASS')) {
      findings.push(`${slug}: REPORT.md does not end in acceptance-checker: PASS`);
    }
  }
  return { exitCode: findings.length ? 1 : 0, findings };
}

function acceptanceEntries(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) return data;
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [{ passes: true, id: 'unreadable' }];
  }
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const root = process.env.HARNESS_ROOT || process.cwd();
  const result = evaluateReportPresent(root);
  if (result.exitCode !== 0) {
    for (const line of result.findings) console.error(line);
  } else {
    console.log('report-present ok');
  }
  process.exit(result.exitCode);
}
