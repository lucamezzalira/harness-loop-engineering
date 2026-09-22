#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, formatAssignmentBlock, requireTool } from './config.mjs';
import { runChecks, reportExitCode, printWhereSummary } from './checks/runner.mjs';
import { resolveHarnessEnv } from './checks/common.mjs';
import { writeReport, readReport } from './report.mjs';
import { computeTreeHash } from './tree-hash.mjs';
import { runInstall } from './install.mjs';
import { renderAdapter } from './render/render.mjs';
import { sessionStart } from './enforce/session_start.mjs';
import { preTool } from './enforce/pre_tool.mjs';
import { postTool } from './enforce/post_tool.mjs';
import { stopSequence, preCommitGate } from './enforce/stop.mjs';
import { runPlan } from './plan/plan.mjs';
import { runLoop, runResume } from './plan/loop.mjs';
import { renderBacklog } from './panel/backlog.mjs';
import { renderReport } from './accounting.mjs';
import { createLogger, newSessionId } from './log.mjs';

const VERSION = '0.1.0';
const ROOT =
  process.env.HARNESS_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ACTION_FLAGS = new Set([
  '--edit',
  '--turn',
  '--plan',
  '--loop',
  '--resume',
  '--status',
  '--report',
  '--backlog',
  '--install',
  '--render',
  '--hook',
  '--help',
  '-h',
  '--version',
  '-v',
]);

function usage() {
  return `verify.sh — harness for Node projects

Usage (flags select the action; configuration supplies every parameter; no flag takes a value):

  ./verify.sh                   commit tier (default)
  ./verify.sh --edit            edit tier
  ./verify.sh --turn            turn tier
  ./verify.sh --plan            decompose PRD, then stop
  ./verify.sh --loop            run the plan
  ./verify.sh --resume          continue recorded run
  ./verify.sh --status          resolved config + current run
  ./verify.sh --report          session cost/token recap
  ./verify.sh --backlog         P2 and below list
  ./verify.sh --install         detect, write harness, wire hooks
  ./verify.sh --render          write adapter for configured tool
  ./verify.sh --render --check  exit 1 on drift
  ./verify.sh --hook            hook payload on stdin
  ./verify.sh -h | --help
  ./verify.sh -v | --version

Exit codes: 0 pass · 1 code wrong (fix & retry) · 2 harness wrong (stop, never retry as code)
`;
}

function parseArgs(argv) {
  const flags = new Set(argv);
  const unknown = argv.filter((a) => a.startsWith('-') && !ACTION_FLAGS.has(a) && a !== '--check');
  if (unknown.length) {
    const err = new Error(`Unknown flag(s): ${unknown.join(', ')}\n\n${usage()}`);
    err.exitCode = 2;
    throw err;
  }

  const actions = [...flags].filter((f) => ACTION_FLAGS.has(f) && f !== '--check');
  // --render --check is one action
  const normalized = actions.filter((a) => a !== '-h' && a !== '-v');
  if (flags.has('--help') || flags.has('-h')) return { action: 'help' };
  if (flags.has('--version') || flags.has('-v')) return { action: 'version' };

  const primary = normalized.filter((a) => a !== '--check');
  if (primary.length > 1) {
    const err = new Error(
      `Two action flags: ${primary.join(' and ')}. Use only one.\n\n${usage()}`,
    );
    err.exitCode = 2;
    throw err;
  }

  if (flags.has('--render')) return { action: 'render', check: flags.has('--check') };
  if (primary.length === 0) return { action: 'verify', tier: 'commit' };
  const a = primary[0];
  const map = {
    '--edit': { action: 'verify', tier: 'edit' },
    '--turn': { action: 'verify', tier: 'turn' },
    '--plan': { action: 'plan' },
    '--loop': { action: 'loop' },
    '--resume': { action: 'resume' },
    '--status': { action: 'status' },
    '--report': { action: 'report' },
    '--backlog': { action: 'backlog' },
    '--install': { action: 'install' },
    '--hook': { action: 'hook' },
  };
  return map[a];
}

async function readStdinJson() {
  // Hooks must not hang if the host leaves stdin open. Cap wait at 2s.
  if (process.stdin.isTTY) return {};
  const chunks = [];
  const raw = await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf8').trim());
    };
    const t = setTimeout(finish, 2000);
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {
      clearTimeout(t);
      finish();
    });
    process.stdin.on('error', () => {
      clearTimeout(t);
      finish();
    });
  });
  if (!raw) return {};
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return { raw };
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(e.exitCode || 2);
  }

  if (parsed.action === 'help') {
    console.log(usage());
    process.exit(0);
  }
  if (parsed.action === 'version') {
    console.log(VERSION);
    process.exit(0);
  }

  // Ensure state dir
  fs.mkdirSync(path.join(ROOT, 'harness', 'state'), { recursive: true });

  let harnessEnv;
  try {
    harnessEnv = resolveHarnessEnv(process.env);
    process.env.HARNESS_ENV = harnessEnv;
  } catch (e) {
    console.error(e.message);
    process.exit(e.exitCode || 2);
  }

  let config;
  try {
    config = loadConfig(ROOT);
  } catch (e) {
    console.error(e.message);
    process.exit(e.exitCode || 2);
  }

  try {
    if (parsed.action === 'verify') {
      const report = await runChecks(ROOT, config, { tier: parsed.tier, harnessEnv });
      const code = reportExitCode(report);
      if (code !== 0) {
        console.error(
          JSON.stringify(
            { status: report.status, tier: report.tier, env: report.env, treeHash: report.treeHash },
            null,
            2,
          ),
        );
        for (const c of report.checks.filter(
          (x) => x.status === 'fail' || x.status === 'harness-error',
        )) {
          console.error(`\n[${c.name}] ${c.status}\n${c.output || c.reason || ''}`);
        }
        printWhereSummary(report, { log: console.error });
      } else {
        console.log(
          `pass tier=${report.tier} env=${report.env} treeHash=${report.treeHash} (${report.durationMs}ms)`,
        );
        printWhereSummary(report);
      }
      process.exit(code);
    }

    if (parsed.action === 'install') {
      const r = await runInstall(ROOT);
      process.exit(r.exitCode);
    }

    if (parsed.action === 'render') {
      const r = await renderAdapter(ROOT, config, { checkOnly: parsed.check });
      console.log(parsed.check ? `render check ok (${r.tool})` : `rendered ${r.tool} adapter`);
      process.exit(0);
    }

    if (parsed.action === 'status') {
      try {
        requireTool(config);
      } catch (e) {
        console.error(e.message);
        process.exit(2);
      }
      const enforcement = config.hooks?.enable !== false ? 'on' : 'off';
      console.log(`enforcement: ${enforcement}`);
      console.log(`tool: ${config.tool} · profile: ${config.profile || 'default'}`);
      console.log(`env: ${harnessEnv} (HARNESS_ENV)`);
      console.log(`prd: ${config.loop?.prd || '(none)'}`);
      console.log('');
      console.log(formatAssignmentBlock(config));
      console.log('');
      console.log(`treeHash: ${computeTreeHash(ROOT)}`);
      const report = readReport(ROOT);
      if (report) {
        console.log(
          `last report: ${report.status} tier=${report.tier}` +
            (report.hasWarnings ? ' hasWarnings' : ''),
        );
      }
      const session = path.join(ROOT, 'harness', 'state', 'session.json');
      if (fs.existsSync(session)) {
        console.log(
          'session:',
          JSON.stringify(JSON.parse(fs.readFileSync(session, 'utf8')), null, 2),
        );
      } else {
        console.log('session: (none)');
      }
      process.exit(0);
    }

    if (parsed.action === 'report') {
      console.log(renderReport(ROOT));
      process.exit(0);
    }

    if (parsed.action === 'backlog') {
      console.log(renderBacklog(ROOT));
      process.exit(0);
    }

    if (parsed.action === 'plan') {
      const r = await runPlan(ROOT, config);
      console.log(r.message);
      process.exit(r.exitCode);
    }

    if (parsed.action === 'loop') {
      const r = await runLoop(ROOT, config);
      if (r.message) console.log(r.message);
      process.exit(r.exitCode);
    }

    if (parsed.action === 'resume') {
      const r = await runResume(ROOT, config);
      if (r.message) console.log(r.message);
      process.exit(r.exitCode);
    }

    if (parsed.action === 'hook') {
      process.env.HARNESS_IN_HOOK = '1';
      const payload = await readStdinJson();
      const keys = Object.keys(payload || {}).filter((k) => k !== 'raw');
      const moment =
        process.env.HARNESS_HOOK_MOMENT ||
        payload.moment ||
        payload.hook_event_name ||
        payload.hookEventName ||
        payload.event ||
        inferMoment(payload);

      // Empty / untyped payloads must NEVER run stop.
      // Thin scripts set HARNESS_HOOK_MOMENT even when stdin is empty.
      if (!process.env.HARNESS_HOOK_MOMENT && (moment === 'noop' || keys.length === 0)) {
        warnHookFailOpen(
          'empty or untyped hook payload',
          payload,
          [
            'The host tool did not send moment / hook_event_name.',
            'Harness fail-opens (exit 0) so Cursor is not wedged by failClosed.',
            'Prefer split adapters: node hooks/before-shell.mjs (sets moment explicitly).',
            'Recover if wedged: echo \'{"version":1,"hooks":{}}\' > .cursor/hooks.json && Reload Window.',
            'See harness/render/cursor/HOOKS.md',
          ].join('\n'),
        );
        console.log(
          JSON.stringify({
            ok: true,
            continue: true,
            permission: 'allow',
            moment: 'noop',
            failOpen: true,
          }),
        );
        process.exit(0);
      }

      if (isMoment(moment, ['session_start', 'SessionStart', 'sessionStart'])) {
        const info = sessionStart(ROOT, config);
        console.log(
          JSON.stringify({
            ok: true,
            continue: true,
            moment: 'sessionStart',
            treeHash: info.treeHash,
          }),
        );
        process.exit(0);
      }

      if (
        isMoment(moment, [
          'beforeShellExecution',
          'beforeMCPExecution',
          'pre_tool',
          'PreToolUse',
          'preToolUse',
        ])
      ) {
        const shellPayload = normalizeShellPayload(payload, moment);
        const decision = preTool(ROOT, shellPayload);
        if (!decision.allow) {
          const msg = decision.reasons.join('\n');
          console.error(msg);
          console.log(
            JSON.stringify({
              ok: false,
              continue: false,
              permission: 'deny',
              user_message: msg,
              agent_message: msg,
              userMessage: msg,
              moment,
            }),
          );
          process.exit(2);
        }
        console.log(
          JSON.stringify({ ok: true, continue: true, permission: 'allow', moment }),
        );
        process.exit(0);
      }

      if (isMoment(moment, ['afterFileEdit', 'post_tool', 'PostToolUse', 'postToolUse'])) {
        const filePath =
          payload.file_path ||
          payload.filePath ||
          payload.tool_input?.file_path ||
          payload.input?.file_path;
        const r = await postTool(ROOT, config, {
          ...payload,
          file_path: filePath,
          tool_input: { ...(payload.tool_input || {}), file_path: filePath },
        });
        if (r.report?.status === 'fail') {
          console.error(
            `[afterFileEdit] edit-tier failed. Fix before stop.\n` +
              (r.report.checks || [])
                .filter((c) => c.status === 'fail')
                .map((c) => `- ${c.name}: ${(c.output || c.reason || '').slice(0, 400)}`)
                .join('\n'),
          );
        }
        console.log(
          JSON.stringify({
            ok: true,
            continue: true,
            moment: 'afterFileEdit',
            reportStatus: r.report?.status,
          }),
        );
        process.exit(0);
      }

      if (isMoment(moment, ['stop', 'Stop'])) {
        const r = await stopSequence(ROOT, config, { cadence: 'turn' });
        if (r.message) console.error(r.message);
        if (!r.allow) {
          const followup =
            r.message ||
            `Harness blocked stop (${r.reason}). Fix harness/state/review.md and report.json, then continue.`;
          console.log(
            JSON.stringify({
              ok: false,
              continue: true,
              moment: 'stop',
              reason: r.reason,
              followup_message: String(followup).slice(0, 4000),
            }),
          );
          process.exit(0);
        }
        console.log(
          JSON.stringify({ ok: true, continue: true, moment: 'stop', reason: r.reason }),
        );
        process.exit(0);
      }

      if (isMoment(moment, ['pre_commit', 'pre-commit'])) {
        const r = preCommitGate(ROOT, {
          agentInitiated: payload.agentInitiated !== false,
          explicitInstruction: Boolean(payload.explicitInstruction),
        });
        if (!r.allow) {
          console.error(r.reason);
          console.log(
            JSON.stringify({
              ok: false,
              continue: false,
              permission: 'deny',
              moment: 'pre_commit',
              reason: r.reason,
            }),
          );
          process.exit(2);
        }
        console.log(
          JSON.stringify({
            ok: true,
            continue: true,
            moment: 'pre_commit',
            trailer: r.trailer || null,
          }),
        );
        process.exit(0);
      }

      warnHookFailOpen(
        `unknown hook moment "${moment}"`,
        payload,
        [
          'Unrecognized event. Fail-open (exit 0) to avoid wedging the IDE.',
          'Expected: sessionStart | beforeShellExecution | beforeMCPExecution | afterFileEdit | stop',
          'See harness/render/cursor/HOOKS.md',
        ].join('\n'),
      );
      console.log(
        JSON.stringify({
          ok: true,
          continue: true,
          permission: 'allow',
          moment: String(moment),
          failOpen: true,
        }),
      );
      process.exit(0);
    }
  } catch (e) {
    console.error(e.message || e);
    if (e.stack && process.env.HARNESS_DEBUG) console.error(e.stack);
    process.exit(e.exitCode || 2);
  }
}

function isMoment(moment, names) {
  return names.includes(moment);
}

/** Map Cursor beforeShellExecution fields into preTool's expected shape. */
function normalizeShellPayload(payload, moment) {
  const command =
    payload.command ||
    payload.tool_input?.command ||
    payload.input?.command ||
    '';
  return {
    ...payload,
    moment,
    tool_name:
      moment === 'beforeMCPExecution'
        ? payload.tool_name || payload.toolName || 'MCP'
        : payload.tool_name || payload.toolName || 'Shell',
    tool_input: {
      ...(payload.tool_input || payload.input || {}),
      command,
    },
  };
}

/**
 * Infer moment only from strong signals. Never default to stop.
 * Empty / ambiguous → noop (fail-open).
 */
function inferMoment(payload) {
  if (payload.hook_event_name || payload.hookEventName) {
    return payload.hook_event_name || payload.hookEventName;
  }
  if (payload.tool_name || payload.toolName) {
    if (payload.tool_result != null || payload.result != null) return 'post_tool';
    return 'pre_tool';
  }
  return 'noop';
}

/**
 * Loud, copy-pasteable warning so a developer can fix the adapter.
 */
function warnHookFailOpen(title, payload, guidance) {
  const line = '='.repeat(72);
  console.error(line);
  console.error(`HARNESS HOOK FAIL-OPEN: ${title}`);
  console.error(line);
  console.error(guidance);
  console.error('--- payload keys ---');
  console.error(JSON.stringify(Object.keys(payload || {})));
  if (process.env.HARNESS_DEBUG) {
    console.error('--- payload ---');
    console.error(JSON.stringify(payload, null, 2).slice(0, 2000));
  }
  console.error(line);
}

main();
