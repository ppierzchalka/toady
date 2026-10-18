import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTeam, conflictingSkills, parseAgentFile, serializeAgentFile } from './installTeam.js';
import { locateInstructions } from './harness.js';
import type { TeamConfig } from '../types.js';

let root: string;
let defsDir: string;
let skillDir: string;
let targetDir: string;

function writeFixture() {
  defsDir = join(root, 'defs');
  skillDir = join(root, 'skills', 'autonomous-implement');
  targetDir = join(root, 'target');
  mkdirSync(defsDir, { recursive: true });
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(
    join(defsDir, 'lead.md'),
    '---\ndescription: Orchestrates the pipeline\nmode: primary\n---\nYou are the lead agent.\n',
  );
  writeFileSync(
    join(defsDir, 'tester.md'),
    '---\ndescription: Writes tests first\nmode: subagent\n---\nYou are the tester agent.\n',
  );
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '# autonomous-implement\n\nRuns the pipeline.\n',
  );
  writeFileSync(join(skillDir, 'TEAM-POLICY.md'), '# Team policy\n\nConfirm command permissions.\n');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'install-team-'));
  writeFixture();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('parseAgentFile / serializeAgentFile', () => {
  it('round-trips frontmatter and body', () => {
    const content = '---\ndescription: hello\nmode: primary\n---\nBody text.\n';
    const parsed = parseAgentFile(content);
    expect(parsed.frontmatter).toEqual({ description: 'hello', mode: 'primary' });
    expect(parsed.body).toBe('Body text.\n');
    expect(serializeAgentFile(parsed.frontmatter, parsed.body)).toBe(content);
  });
});

describe('installTeam', () => {
  it('writes all agent definitions with their canonical frontmatter and body', () => {
    const result = installTeam({ definitionsDir: defsDir, skillDir, config: {}, targetDir });
    expect(result.written).toHaveLength(2);
    expect(result.written.map((p) => p.split('/').pop())).toEqual(expect.arrayContaining(['lead.md', 'tester.md']));

    const lead = parseAgentFile(readFileSync(join(targetDir, '.opencode/agents/lead.md'), 'utf8'));
    expect(lead.frontmatter.description).toBe('Orchestrates the pipeline');
    expect(lead.frontmatter.model).toBeUndefined();
    expect(lead.body).toContain('You are the lead agent.');
  });

  it('omits model key when model is unset', () => {
    installTeam({ definitionsDir: defsDir, skillDir, config: {}, targetDir });
    const tester = readFileSync(join(targetDir, '.opencode/agents/tester.md'), 'utf8');
    expect(tester).not.toContain('model:');
    expect(tester).not.toContain('reasoningEffort:');
  });

  it('applies model and reasoningEffort from config', () => {
    const config: TeamConfig = {
      lead: { model: 'openai/gpt-6-astra', reasoningEffort: 'high' },
    };
    installTeam({ definitionsDir: defsDir, skillDir, config, targetDir });
    const lead = parseAgentFile(readFileSync(join(targetDir, '.opencode/agents/lead.md'), 'utf8'));
    expect(lead.frontmatter.model).toBe('openai/gpt-6-astra');
    expect(lead.frontmatter.reasoningEffort).toBe('high');
  });

  it('copies the skill into the target skills directory', () => {
    const result = installTeam({ definitionsDir: defsDir, skillDir, config: {}, targetDir });
    const skillPath = join(targetDir, '.opencode/skills/autonomous-implement/SKILL.md');
    expect(result.skillPath).toBe(skillPath);
    expect(readFileSync(skillPath, 'utf8')).toContain('Runs the pipeline.');
    expect(readFileSync(join(targetDir, '.opencode/skills/autonomous-implement/TEAM-POLICY.md'), 'utf8'))
      .toContain('Confirm command permissions.');
  });

  it('writes team.config.json', () => {
    const config: TeamConfig = { lead: { model: 'google/gemini-3.6-flash' } };
    const result = installTeam({ definitionsDir: defsDir, skillDir, config, targetDir });
    expect(JSON.parse(readFileSync(result.configPath, 'utf8'))).toEqual(config);
  });

  it('preserves an existing agent prompt when overwrite is false but still applies the model', () => {
    const first: TeamConfig = {};
    installTeam({ definitionsDir: defsDir, skillDir, config: first, targetDir });
    const agentPath = join(targetDir, '.opencode/agents/lead.md');
    writeFileSync(agentPath, '---\ndescription: Custom edit\nmode: primary\n---\nMy custom prompt.\n');

    const second: TeamConfig = { lead: { model: 'deepseek/deepseek-v4-flash' } };
    const result = installTeam({
      definitionsDir: defsDir,
      skillDir,
      config: second,
      targetDir,
      overwrite: { lead: false },
    });

    expect(result.preserved).toContain(agentPath);
    const lead = parseAgentFile(readFileSync(agentPath, 'utf8'));
    expect(lead.frontmatter.description).toBe('Custom edit');
    expect(lead.frontmatter.model).toBe('deepseek/deepseek-v4-flash');
    expect(lead.body).toContain('My custom prompt.');
    expect(readFileSync(join(targetDir, '.opencode/skills/autonomous-implement/references/roles/lead.md'), 'utf8')).toBe(lead.body);
  });

  it('overwrites an agent prompt when overwrite is true', () => {
    const agentPath = join(targetDir, '.opencode/agents/lead.md');
    installTeam({ definitionsDir: defsDir, skillDir, config: {}, targetDir, overwrite: { lead: true } });
    const lead = parseAgentFile(readFileSync(agentPath, 'utf8'));
    expect(lead.frontmatter.description).toBe('Orchestrates the pipeline');
    expect(lead.body).toContain('You are the lead agent.');
  });

  it('creates the .opencode/agents directory', () => {
    expect(existsSync(join(targetDir, '.opencode/agents'))).toBe(true);
    expect(readdirSync(join(targetDir, '.opencode/agents'))).toEqual(expect.arrayContaining(['lead.md', 'tester.md']));
  });

  it('installs the shipped team as a self-contained prompt bundle', () => {
    const shippedRoot = fileURLToPath(new URL('../../', import.meta.url));
    const destination = join(root, 'shipped-team');
    const result = installTeam({
      definitionsDir: join(shippedRoot, 'agents'),
      skillDir: join(shippedRoot, 'skills', 'autonomous-implement'),
      config: {},
      targetDir: destination,
    });
    expect(result.written).toHaveLength(8);

    for (const role of ['lead', 'developer', 'reviewer']) {
      const canonical = parseAgentFile(readFileSync(join(shippedRoot, 'agents', `${role}.md`), 'utf8'));
      const installed = parseAgentFile(readFileSync(join(destination, '.opencode/agents', `${role}.md`), 'utf8'));
      expect(installed.body, role).toBe(locateInstructions(canonical.body, 'opencode'));
    }
    for (const document of [
      'autonomous-implement/TEAM-POLICY.md',
      'autonomous-implement/references/run-contract.md',
      'implement-task/SKILL.md',
      'review-change/SKILL.md',
    ]) {
      expect(readFileSync(join(destination, '.opencode/skills', document), 'utf8'), document)
        .toBe(readFileSync(join(shippedRoot, 'skills', document), 'utf8'));
    }

    // Every role's shared-policy pointer must work in the installed repo.
    for (const path of result.written) {
      const agent = parseAgentFile(readFileSync(path, 'utf8'));
      expect(agent.frontmatter.description).toEqual(expect.any(String));
      const pointer = agent.body.match(/`(\.opencode\/skills\/[^`]+\/TEAM-POLICY\.md)`/);
      if (!pointer) throw new Error(`Missing shared-policy pointer in ${path}`);
      expect(existsSync(join(destination, pointer[1]))).toBe(true);
      for (const reference of agent.body.matchAll(/`(\.opencode\/skills\/[^`]+\.md)`/g)) {
        expect(existsSync(join(destination, reference[1])), `${path}: ${reference[1]}`).toBe(true);
      }
    }

    // Exercise recursive copying and resolve local Markdown links, including
    // the conditional references needed only by some stages.
    const installedSkill = join(destination, '.opencode/skills/autonomous-implement');
    const documents = ['SKILL.md', 'TEAM-POLICY.md', 'references/run-contract.md', 'references/worktrees.md', 'references/stack-guidance.md', 'references/interface-design.md', 'references/proposals.md', 'references/usage.md'];
    for (const document of documents) {
      const path = join(installedSkill, document);
      expect(existsSync(path), document).toBe(true);
      const content = readFileSync(path, 'utf8');
      for (const link of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
        expect(existsSync(join(dirname(path), link[1])), `${document}: ${link[1]}`).toBe(true);
      }
    }
    const skill = parseAgentFile(readFileSync(result.skillPath, 'utf8'));
    expect(skill.frontmatter.name).toBe('autonomous-implement');
    expect(skill.frontmatter.description).toEqual(expect.any(String));
    expect(readdirSync(join(destination, '.opencode/skills')).sort()).toEqual(['architecture-assess', 'autonomous-implement', 'decision-gates', 'implement-task', 'interface-assess', 'plan', 'project-setup', 'refine', 'review-change', 'security-assess', 'slice', 'test-design', 'wayfinder']);
    expect(result.skillPaths).toHaveLength(13);
    for (const path of result.skillPaths) {
      const content = readFileSync(path, 'utf8');
      expect(parseAgentFile(content).frontmatter.description).toEqual(expect.any(String));
      for (const link of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
        expect(existsSync(join(dirname(path), link[1])), `${path}: ${link[1]}`).toBe(true);
      }
    }
  });

  it('preserves project tracker conventions and unrelated skills during reinstall', () => {
    const shippedRoot = fileURLToPath(new URL('../../', import.meta.url));
    const destination = join(root, 'existing-project');
    const tracker = join(destination, 'docs/agents/issue-tracker.md');
    const customSkill = join(destination, '.opencode/skills/custom/SKILL.md');
    mkdirSync(dirname(tracker), { recursive: true });
    mkdirSync(dirname(customSkill), { recursive: true });
    writeFileSync(tracker, 'Azure project-specific fields and workflow');
    writeFileSync(customSkill, 'User-owned skill');
    for (let pass = 0; pass < 2; pass++) {
      installTeam({
        definitionsDir: join(shippedRoot, 'agents'),
        skillDir: join(shippedRoot, 'skills/autonomous-implement'),
        config: { analyst: { model: 'custom/planning' }, lead: { model: 'custom/execution' } },
        targetDir: destination,
      });
    }
    expect(readFileSync(tracker, 'utf8')).toBe('Azure project-specific fields and workflow');
    expect(readFileSync(customSkill, 'utf8')).toBe('User-owned skill');
    expect(parseAgentFile(readFileSync(join(destination, '.opencode/agents/analyst.md'), 'utf8')).frontmatter.model).toBe('custom/planning');
    expect(parseAgentFile(readFileSync(join(destination, '.opencode/agents/lead.md'), 'utf8')).frontmatter.model).toBe('custom/execution');
  });

  it('writes the current skill owner and recognizes the prior namespace without adoption', () => {
    const options = { definitionsDir: defsDir, skillDir, config: {}, targetDir };
    const result = installTeam(options);
    expect(JSON.parse(readFileSync(join(targetDir, '.opencode/skills/autonomous-implement/.team-owner.json'), 'utf8'))).toEqual({ owner: 'toady' });
    // A prior-namespace marker counts as owned: no adoption prompt.
    writeFileSync(join(targetDir, '.opencode/skills/autonomous-implement/.team-owner.json'), JSON.stringify({ owner: 'spec-driven-scrum-team' }) + '\n');
    expect(conflictingSkills(options)).toEqual([]);
    // Refresh consolidates the marker back to the current namespace.
    installTeam(options);
    expect(JSON.parse(readFileSync(join(targetDir, '.opencode/skills/autonomous-implement/.team-owner.json'), 'utf8'))).toEqual({ owner: 'toady' });
    expect(result.skillPath).toBe(join(targetDir, '.opencode/skills/autonomous-implement/SKILL.md'));
  });
});
