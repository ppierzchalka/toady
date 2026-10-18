import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { installTeam, preflightTeam } from './installTeam.js';
import { checkInstallPath } from './installPaths.js';
import { installPersonalInstructions } from './personalInstructions.js';
import { HARNESS_LAYOUTS, HARNESS_NAMES } from './harness.js';

const source = fileURLToPath(new URL('../../', import.meta.url));
const privateContext = vi.hoisted(() => ({ root: '' }));
vi.mock('./personalPaths.js', () => ({ personalConfigRoot: (harness: string) => join(privateContext.root, 'user', harness) }));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'team-paths-')); roots.push(root); privateContext.root = root;
  const targetDir = join(root, 'target'); const outside = join(root, 'outside');
  mkdirSync(targetDir); mkdirSync(outside);
  return { targetDir, outside, options: { targetDir, config: {}, definitionsDir: join(source, 'agents'), skillDir: join(source, 'skills/autonomous-implement') } };
}

describe('install preflight', () => {
  it.each(HARNESS_NAMES)('rejects linked %s destinations before any team writes', harness => {
    const { targetDir, outside, options } = fixture();
    const path = join(targetDir, HARNESS_LAYOUTS[harness].agents);
    mkdirSync(join(path, '..'), { recursive: true }); symlinkSync(outside, path, 'dir');
    expect(() => installTeam({ ...options, harness })).toThrow('symlink');
    expect(existsSync(join(targetDir, HARNESS_LAYOUTS[harness].config))).toBe(false);
    expect(existsSync(join(outside, 'lead.md'))).toBe(false);
  });
  it.each(['config', 'agent', 'nested-skill', 'dangling', 'root'])('rejects %s links without partial writes', kind => {
    const { targetDir, outside, options } = fixture();
    let dest = join(targetDir, '.opencode/team.config.json');
    if (kind === 'agent') dest = join(targetDir, '.opencode/agents/reviewer.md');
    if (kind === 'nested-skill' || kind === 'dangling') dest = join(targetDir, '.opencode/skills/autonomous-implement/references/usage.md');
    if (kind === 'root') {
      const linked = join(targetDir, 'linked'); symlinkSync(outside, linked, 'dir');
      expect(() => installTeam({ ...options, targetDir: linked })).toThrow('symlink'); return;
    }
    mkdirSync(join(dest, '..'), { recursive: true });
    const external = join(outside, 'sentinel');
    if (kind !== 'dangling') writeFileSync(external, 'untouched');
    symlinkSync(external, dest);
    expect(() => installTeam(options)).toThrow('symlink');
    expect(existsSync(join(targetDir, '.opencode/agents/analyst.md'))).toBe(false);
    if (kind !== 'dangling') expect(readFileSync(external, 'utf8')).toBe('untouched');
  });
  it('rejects lexical escape and destination type conflicts', () => {
    const { targetDir, outside, options } = fixture();
    expect(() => checkInstallPath(targetDir, outside)).toThrow('escapes');
    const path = join(targetDir, '.opencode/skills/autonomous-implement/SKILL.md');
    mkdirSync(path, { recursive: true });
    expect(() => preflightTeam({ ...options, replaceSkills: true })).toThrow('regular file');
    expect(existsSync(join(targetDir, '.opencode/agents'))).toBe(false);
  });
  it('protects an unowned skill and adopts only with explicit scope', () => {
    const { targetDir, options } = fixture();
    const path = join(targetDir, '.opencode/skills/wayfinder/SKILL.md');
    mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'Another package');
    expect(() => installTeam(options)).toThrow('Unowned skill name conflicts: wayfinder');
    expect(readFileSync(path, 'utf8')).toBe('Another package');
    expect(existsSync(join(targetDir, '.opencode/agents'))).toBe(false);
    installTeam({ ...options, replaceSkills: true });
    installTeam(options); // own marker permits ordinary reinstallation
    expect(readFileSync(path, 'utf8')).toContain('name: wayfinder');
  });
  it('validates personal instructions without mutation before team installation', () => {
    const { targetDir, options } = fixture();
    writeFileSync(join(targetDir, 'opencode.json'), '{broken');
    preflightTeam(options);
    expect(() => installPersonalInstructions(targetDir, 'opencode', true, 'No any.')).toThrow('Invalid OpenCode');
    expect(existsSync(join(targetDir, '.opencode'))).toBe(false);
  });
  it('exports explicit native model selections alongside portable roles', () => {
    const { targetDir, options } = fixture();
    installTeam({ ...options, harness: 'codex', config: { developer: { model: 'approved', reasoningEffort: 'high' } } });
    const runtime = JSON.parse(readFileSync(join(targetDir, '.agents/skills/autonomous-implement/references/roles/runtime.json'), 'utf8'));
    expect(runtime.agents.developer).toMatchObject({ model: 'approved', reasoningEffort: 'high', nativeDefinition: '.codex/agents/developer.toml' });
    expect(runtime.agents.reviewer).not.toHaveProperty('model');
  });
  it.each(['references/roles', 'references/roles/runtime.json', 'references/roles/lead.md'])('rejects invalid generated output %s before writes', relative => {
    const { targetDir, options } = fixture();
    const path = join(targetDir, '.opencode/skills/autonomous-implement', relative);
    if (relative === 'references/roles') {
      mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'not a directory');
    } else mkdirSync(path, { recursive: true });
    expect(() => installTeam({ ...options, replaceSkills: true })).toThrow();
    expect(existsSync(join(targetDir, '.opencode/agents'))).toBe(false);
  });
  it('rejects a directory in place of a legacy generated instructions file before runtime config writes', () => {
    const { targetDir, options } = fixture();
    mkdirSync(join(targetDir, '.opencode/personas/toady.md'), { recursive: true });
    preflightTeam(options);
    expect(() => installPersonalInstructions(targetDir, 'opencode', true, 'No any.')).toThrow('regular file');
    expect(existsSync(join(targetDir, 'opencode.json'))).toBe(false);
    expect(existsSync(join(targetDir, '.opencode/agents'))).toBe(false);
  });
  it('CLI validates late team destinations before personal instruction migration', () => {
    const { targetDir } = fixture();
    const root = mkdtempSync(join(tmpdir(), 'team-cli-home-')); roots.push(root);
    mkdirSync(join(targetDir, '.agents/skills/autonomous-implement/references/roles/runtime.json'), { recursive: true });
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', join(source, 'src/cli.ts'),
      '--harness=codex', '--defaults', '--replace-skills'],
      {
        stdio: 'pipe',
        cwd: targetDir,
        env: { ...process.env, XDG_CONFIG_HOME: join(root, 'xdg'), CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex'), HOME: root },
      })).toThrow();
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(targetDir, '.codex'))).toBe(false);
  });
});
