import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { HARNESS_NAMES, HARNESS_LAYOUTS, renderAgent } from './harness.js';
import { installTeam, parseAgentFile } from './installTeam.js';

const source = fileURLToPath(new URL('../../', import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('harness installations', () => {
  it.each(HARNESS_NAMES)('installs only %s native agents and resolves shared references', (harness) => {
    const targetDir = mkdtempSync(join(tmpdir(), 'team-harness-'));
    roots.push(targetDir);
    writeFileSync(join(targetDir, '.gitignore'), '# user rules\nprivate/\n');
    const result = installTeam({
      definitionsDir: join(source, 'agents'), skillDir: join(source, 'skills/autonomous-implement'),
      config: {}, targetDir, harness,
    });
    const layout = HARNESS_LAYOUTS[harness];
    expect(result.written).toHaveLength(8);
    expect(result.skillPaths).toHaveLength(13);
    const ignore = readFileSync(join(targetDir, '.gitignore'), 'utf8');
    expect(ignore).toContain('# user rules\nprivate/\n');
    for (const entry of [layout.agents + '/', layout.skills + '/', layout.config]) {
      expect(ignore).toContain(entry);
    }
    expect(ignore).toContain('# toady:gitignore:start');
    expect(ignore).toContain('# toady:gitignore:end');
    expect(ignore).not.toContain('spec-driven-scrum-team');
    for (const other of HARNESS_NAMES) {
      if (other !== harness) expect(existsSync(join(targetDir, HARNESS_LAYOUTS[other].agents))).toBe(false);
    }
    for (const path of result.written) {
      const content = readFileSync(path, 'utf8');
      const instructions = harness === 'codex'
        ? String(parseToml(content).developer_instructions)
        : parseAgentFile(content).body;
      for (const match of instructions.matchAll(/`([^\`]+\/skills\/[^\`]+\.md)`/g)) {
        expect(existsSync(join(targetDir, match[1])), match[1]).toBe(true);
      }
      expect(content).not.toContain('openai/gpt-6.1-sol');
      expect(path).toContain(layout.agents);
    }
    expect(existsSync(join(targetDir, layout.skills, 'autonomous-implement/references/roles/lead.md'))).toBe(true);
  });

  it('creates a managed gitignore block with the installed paths when missing', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'team-ignore-'));
    roots.push(targetDir);
    const result = installTeam({ definitionsDir: join(source, 'agents'), skillDir: join(source, 'skills/autonomous-implement'), config: {}, targetDir, harness: 'codex' });
    const ignore = readFileSync(join(targetDir, '.gitignore'), 'utf8');
    expect(result.gitignorePath).toBe(join(targetDir, '.gitignore'));
    for (const entry of ['.codex/agents/', '.agents/skills/', '.codex/team.config.json']) {
      expect(ignore).toContain(entry);
    }
    expect(ignore.endsWith('\n')).toBe(true);
  });

  it('preserves custom TOML instructions and native settings on model-only reconfigure', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'team-toml-'));
    roots.push(targetDir);
    const options = { definitionsDir: join(source, 'agents'), skillDir: join(source, 'skills/autonomous-implement'), config: {}, targetDir, harness: 'codex' as const };
    installTeam(options);
    const path = join(targetDir, '.codex/agents/reviewer.toml');
    writeFileSync(path, 'name = "reviewer"\ndescription = "Custom"\nsandbox_mode = "read-only"\ndeveloper_instructions = "Custom review contract"\n');
    installTeam({ ...options, config: { reviewer: { model: 'native-model', reasoningEffort: 'high' } }, overwrite: { reviewer: false } });
    expect(parseToml(readFileSync(path, 'utf8'))).toMatchObject({
      developer_instructions: 'Custom review contract', sandbox_mode: 'read-only',
      model: 'native-model', model_reasoning_effort: 'high',
    });
    expect(readFileSync(join(targetDir, '.agents/skills/autonomous-implement/references/roles/reviewer.md'), 'utf8')).toBe('Custom review contract');
  });

  it('renders native metadata rather than leaking OpenCode mode/effort', () => {
    const claude = parseAgentFile(renderAgent('reviewer', 'Review', 'Body', { model: 'sonnet', reasoningEffort: 'high' }, 'claude-code'));
    expect(claude.frontmatter).toEqual({ name: 'reviewer', description: 'Review', model: 'sonnet', disallowedTools: ['Write', 'Edit', 'NotebookEdit'] });
    const codex = parseToml(renderAgent('reviewer', 'Review', 'Body', { model: 'native', reasoningEffort: 'high' }, 'codex'));
    expect(codex).toEqual({ name: 'reviewer', description: 'Review', model: 'native', model_reasoning_effort: 'high', sandbox_mode: 'read-only', developer_instructions: 'Body' });
  });

  it('inherits Copilot tools so configured tracker and MCP integrations remain available', () => {
    const lead = parseAgentFile(renderAgent('lead', 'Coordinate', 'Body', undefined, 'copilot'));
    expect(lead.frontmatter).not.toHaveProperty('tools');
  });

  it('preserves Antigravity integrations while updating canonical instructions', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'team-agy-'));
    roots.push(targetDir);
    const options = { definitionsDir: join(source, 'agents'), skillDir: join(source, 'skills/autonomous-implement'), config: {}, targetDir, harness: 'antigravity' as const };
    installTeam(options);
    const path = join(targetDir, '.agents/agents/lead.md');
    writeFileSync(path, '---\nname: lead\ndescription: Custom\ntools: [view_file, tracker_create]\nmcpServers: [{name: tracker}]\n---\nOld instructions\n');
    installTeam({ ...options, config: { lead: { model: 'pro', additionalTools: ['browser_view'] } } });
    const agent = parseAgentFile(readFileSync(path, 'utf8'));
    expect(agent.frontmatter.tools).toEqual(['view_file', 'tracker_create', 'browser_view']);
    expect(agent.frontmatter.mcpServers).toEqual([{ name: 'tracker' }]);
    expect(agent.frontmatter.model).toBe('pro');
    expect(agent.body).toContain('single execution coordinator');
    installTeam({ ...options, config: { lead: { additionalTools: [] } }, overwrite: { lead: false } });
    const cleared = parseAgentFile(readFileSync(path, 'utf8'));
    expect(cleared.frontmatter.tools).toEqual(['view_file', 'tracker_create']);
    expect(cleared.frontmatter.mcpServers).toEqual([{ name: 'tracker' }]);
  });

  it('rejects unsupported Antigravity models before writing files', () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'team-bad-agy-'));
    roots.push(targetDir);
    expect(() => installTeam({
      definitionsDir: join(source, 'agents'), skillDir: join(source, 'skills/autonomous-implement'),
      config: { developer: { model: 'provider/arbitrary' } }, targetDir, harness: 'antigravity',
    })).toThrow('Antigravity model must be inherit, flash or pro');
    expect(existsSync(join(targetDir, '.agents'))).toBe(false);
  });
});
