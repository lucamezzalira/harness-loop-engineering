import { runChecks, reportExitCode } from '../checks/runner.mjs';

/**
 * After an edit: edit tier on that one file. Cannot refuse the edit itself;
 * returns check result for the agent.
 */
export async function postTool(root, config, payload) {
  const filePath =
    payload.tool_input?.file_path || payload.input?.file_path || payload.file_path || payload.path;
  const files = filePath ? [filePath] : undefined;
  const report = await runChecks(root, config, {
    tier: 'edit',
    files,
    failFast: true,
  });
  return { report, exitCode: reportExitCode(report) };
}
