import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { which } from '../checks/common.mjs';
import { invokeFake } from './fake-provider.mjs';

/**
 * Invoke a role: B primary (host tool CLI), fallback A (provider API).
 * @param {object} opts
 * @param {string} opts.root
 * @param {object} opts.config
 * @param {object} opts.binding - from resolveRoleBinding
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt
 * @param {string} opts.expect - 'json' | 'text'
 */
export async function invokeRole(opts) {
  const { root, config, binding, systemPrompt, userPrompt, expect = 'json' } = opts;
  const tool = config.tool;

  if (process.env.HARNESS_FAKE_PROVIDER === '1') {
    return invokeFake({ binding, systemPrompt, userPrompt, expect });
  }

  // B: host tool CLI
  const host = await tryHostTool({ tool, root, binding, systemPrompt, userPrompt, expect });
  if (host.ok) {
    return { ...host, path: 'host-tool', estimated: host.estimated ?? false };
  }

  // A: API fallback
  const api = await tryApi({ binding, systemPrompt, userPrompt, expect });
  if (api.ok) {
    return { ...api, path: 'api', estimated: api.estimated ?? false };
  }

  return {
    ok: false,
    path: 'none',
    error: `Role ${binding.role} could not run.\nHost tool: ${host.error}\nAPI: ${api.error}`,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, estimated: true },
  };
}

async function tryHostTool({ tool, root, binding, systemPrompt, userPrompt, expect }) {
  const prompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  const attempts = [];

  if (tool === 'claude') {
    const bin = which('claude');
    if (!bin) return { ok: false, error: 'claude CLI not on PATH' };
    attempts.push({
      cmd: bin,
      args: ['-p', prompt, '--model', binding.modelId, '--output-format', 'json'],
    });
  } else if (tool === 'cursor') {
    // Prefer cursor-agent if present; else agent CLI
    const bin = which('cursor-agent') || which('agent');
    if (!bin) {
      return {
        ok: false,
        error:
          'cursor-agent/agent CLI not on PATH. Install Cursor CLI or set tool and use API keys for fallback A.',
      };
    }
    attempts.push({
      cmd: bin,
      args: ['--print', '--model', binding.modelId, prompt],
    });
  } else if (tool === 'codex') {
    const bin = which('codex');
    if (!bin) return { ok: false, error: 'codex CLI not on PATH' };
    attempts.push({
      cmd: bin,
      args: ['exec', '--model', binding.modelId, prompt],
    });
  } else {
    return { ok: false, error: `unknown tool ${tool}` };
  }

  for (const a of attempts) {
    try {
      const raw = await runCapture(a.cmd, a.args, { cwd: root, timeout: 600_000 });
      const parsed = parseModelOutput(raw.stdout, expect);
      return {
        ok: true,
        text: raw.stdout,
        data: parsed.data,
        usage: extractUsage(raw.stdout) || estimateUsage(prompt, raw.stdout),
        estimated: !extractUsage(raw.stdout),
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }
  return { ok: false, error: 'no host attempt succeeded' };
}

async function tryApi({ binding, systemPrompt, userPrompt, expect }) {
  const meta = binding.providerMeta || {};
  if (meta.type === 'api' || binding.provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY not set' };
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: binding.modelId,
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        return { ok: false, error: `Anthropic API ${res.status}: ${JSON.stringify(body)}` };
      }
      const text = (body.content || []).map((c) => c.text || '').join('\n');
      const parsed = parseModelOutput(text, expect);
      const usage = {
        inputTokens: body.usage?.input_tokens || 0,
        outputTokens: body.usage?.output_tokens || 0,
        costUsd: 0,
        estimated: false,
      };
      return { ok: true, text, data: parsed.data, usage, estimated: false };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  if (meta.type === 'openai-compatible') {
    const base = (meta.baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: binding.modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, error: `local API ${res.status}: ${JSON.stringify(body)}` };
      const text = body.choices?.[0]?.message?.content || '';
      const parsed = parseModelOutput(text, expect);
      return {
        ok: true,
        text,
        data: parsed.data,
        usage: {
          inputTokens: body.usage?.prompt_tokens || 0,
          outputTokens: body.usage?.completion_tokens || 0,
          costUsd: 0,
          estimated: !body.usage,
        },
        estimated: !body.usage,
      };
    } catch (e) {
      return { ok: false, error: `local endpoint unreachable: ${e.message}` };
    }
  }

  return { ok: false, error: `unsupported provider type for ${binding.provider}` };
}

function parseModelOutput(text, expect) {
  if (expect !== 'json') return { data: text };
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('[');
  const startObj = candidate.indexOf('{');
  let slice = candidate;
  if (start >= 0 && (startObj < 0 || start < startObj)) {
    slice = candidate.slice(start, candidate.lastIndexOf(']') + 1);
  } else if (startObj >= 0) {
    slice = candidate.slice(startObj, candidate.lastIndexOf('}') + 1);
  }
  try {
    return { data: JSON.parse(slice) };
  } catch {
    return { data: null, parseError: true, raw: text };
  }
}

function extractUsage(text) {
  try {
    const j = JSON.parse(text);
    if (j.usage) {
      return {
        inputTokens: j.usage.input_tokens || j.usage.prompt_tokens || 0,
        outputTokens: j.usage.output_tokens || j.usage.completion_tokens || 0,
        costUsd: j.usage.cost_usd || 0,
        estimated: false,
      };
    }
  } catch {
    /* not json */
  }
  return null;
}

function estimateUsage(prompt, output) {
  const inT = Math.ceil(prompt.length / 4);
  const outT = Math.ceil(String(output).length / 4);
  return { inputTokens: inT, outputTokens: outT, costUsd: 0, estimated: true };
}

function runCapture(cmd, args, { cwd, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timeout after ${timeout}ms`));
    }, timeout);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) reject(new Error(stderr || stdout || `exit ${code}`));
      else resolve({ stdout, stderr });
    });
  });
}

/**
 * Probe whether a local OpenAI-compatible endpoint responds.
 */
export async function probeProvider(providerMeta) {
  if (!providerMeta || providerMeta.type !== 'openai-compatible') {
    return { ok: true, detail: 'api provider (no local probe)' };
  }
  const base = (providerMeta.baseUrl || '').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) });
    return { ok: res.ok, detail: `GET ${base}/models → ${res.status}` };
  } catch (e) {
    return { ok: false, detail: `unreachable: ${e.message}` };
  }
}

export function loadRoleFile(root, roleName) {
  const p = path.join(root, 'harness', 'roles', `${roleName}.md`);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}
