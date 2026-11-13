import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ID_PATTERN = /A-\d+/g;
const DEFERRED_PATTERN = /^Deferred:\s*(A-\d+)\s+\([^)\n]+\)\s*$/gm;

/**
 * A spec whose PRD names acceptance ids must list each one as passing,
 * and the report criteria section must name them. An open spec whose
 * ids are all still false, and which has no report, is not a completed claim.
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
    findings.push(...specFindings(slug, dir));
  }
  return { exitCode: findings.length ? 1 : 0, findings };
}

function specFindings(slug, dir) {
  const findings = [];
  const accPath = path.join(dir, 'acceptance.json');
  const entries = fs.existsSync(accPath) ? acceptanceEntries(accPath) : [];
  const prdPath = path.join(dir, 'PRD.md');
  const prd = fs.existsSync(prdPath) ? fs.readFileSync(prdPath, 'utf8') : '';
  const required = requiredIds(prd);
  const byId = new Map(
    entries.filter((entry) => entry && entry.id).map((entry) => [entry.id, entry]),
  );
  const reportPath = path.join(dir, 'REPORT.md');
  const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  const open =
    required.length > 0 &&
    !report &&
    required.every((id) => !byId.get(id) || byId.get(id).passes !== true);

  if (!open) {
    for (const id of required) {
      const entry = byId.get(id);
      if (!entry) {
        findings.push(`${slug}: ${id} is in the PRD and missing from acceptance.json`);
      } else if (entry.passes !== true) {
        findings.push(`${slug}: ${id} is listed with passes: false`);
      }
    }
  }

  if (required.length && report && !open) {
    const criteria = section(report, '## Criteria');
    for (const id of required) {
      if (!criteria.includes(id)) {
        findings.push(`${slug}: REPORT.md criteria does not list ${id}`);
      }
    }
  }

  if (!entries.length || !entries.every((entry) => entry && entry.passes === true)) return findings;
  if (!report) {
    findings.push(`${slug}: acceptance.json is all passing and REPORT.md is missing`);
    return findings;
  }
  if (!report.trim().endsWith('acceptance-checker: PASS')) {
    findings.push(`${slug}: REPORT.md does not end in acceptance-checker: PASS`);
  }
  return findings;
}

export function requiredIds(prd) {
  const deferred = new Set();
  for (const match of String(prd || '').matchAll(DEFERRED_PATTERN)) deferred.add(match[1]);
  const ids = [];
  for (const match of String(prd || '').matchAll(ID_PATTERN)) {
    if (deferred.has(match[0]) || ids.includes(match[0])) continue;
    ids.push(match[0]);
  }
  return ids;
}

function section(markdown, heading) {
  const at = markdown.indexOf(heading);
  if (at < 0) return '';
  const rest = markdown.slice(at + heading.length);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
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
