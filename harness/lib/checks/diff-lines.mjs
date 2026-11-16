/**
 * Added lines from a unified diff. No config load, so a workflow can import
 * this without the yaml package.
 */

export function addedLines(diff) {
  const out = [];
  let file = '';
  let lineNo = 0;
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (!file || file === '/dev/null') continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push({ file, line: lineNo, text: line.slice(1) });
      lineNo += 1;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) continue;
    if (!line.startsWith('\\')) lineNo += 1;
  }
  return out;
}
