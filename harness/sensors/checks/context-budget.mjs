import fs from 'node:fs';
import path from 'node:path';

function countLines(file) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

function skillBodyLines(skillFile) {
  const text = fs.readFileSync(skillFile, 'utf8');
  // strip YAML frontmatter
  const body = text.replace(/^---[\s\S]*?---\n?/, '');
  return body.split('\n').length;
}

/**
 * Ratchet: fail on growth only when baseline is set.
 */
export async function run({ root, config }) {
  const limitAgents = config.limits?.agentsMdLines ?? 200;
  const limitSkill = config.limits?.skillBodyLines ?? 60;
  const baselineAgents = config.baseline?.agentsMdLines;

  const agentsPath = path.join(root, 'AGENTS.md');
  const agentsLines = countLines(agentsPath);
  const failures = [];

  const agentsCeiling =
    baselineAgents != null ? Math.max(limitAgents, baselineAgents) : limitAgents;

  // Ratchet: if baseline > limit, allow up to baseline; fail at baseline+1
  if (baselineAgents != null && baselineAgents > limitAgents) {
    if (agentsLines > baselineAgents) {
      failures.push(
        `AGENTS.md has ${agentsLines} lines; baseline is ${baselineAgents} (ratchet). Growth only is forbidden until the file is under limits.agentsMdLines=${limitAgents}.`,
      );
    }
  } else if (agentsLines > agentsCeiling) {
    failures.push(
      `AGENTS.md has ${agentsLines} lines; limit is ${limitAgents}. Keep under 200 lines so agents do not drop context.`,
    );
  }

  const skillsRoot = path.join(root, 'harness', 'skills');
  if (fs.existsSync(skillsRoot)) {
    for (const dir of fs.readdirSync(skillsRoot)) {
      const skill = path.join(skillsRoot, dir, 'SKILL.md');
      if (!fs.existsSync(skill)) continue;
      const n = skillBodyLines(skill);
      if (n > limitSkill) {
        failures.push(`${path.relative(root, skill)} body has ${n} lines; limit is ${limitSkill}.`);
      }
    }
  }

  if (failures.length) {
    return { status: 'fail', exitCode: 1, output: failures.join('\n') };
  }
  return {
    status: 'pass',
    exitCode: 0,
    output: `AGENTS.md ${agentsLines} lines (ceiling ${agentsCeiling}); skills within ${limitSkill}`,
  };
}
