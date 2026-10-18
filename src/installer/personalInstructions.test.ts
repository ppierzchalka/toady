
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'jsonc-parser';

const context = vi.hoisted(() => ({ root: '' }));
vi.mock('./personalPaths.js', () => ({ personalConfigRoot: (harness: string) => join(context.root, harness) }));
import {
  INSTRUCTIONS_START, installPersonalInstructions, loadPersonalRulesFile,
  personalSettingsPath, readPersonalInstructions, validatePersonalRules,
} from './personalInstructions.js';
const roots: string[] = [];
function workspace(): string { const root = mkdtempSync(join(tmpdir(), 'instructions-')); roots.push(root); return root; }
function put(path: string, body: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
beforeEach(() => { context.root = workspace(); });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const layouts = [
  ['opencode', 'AGENTS.md'], ['claude-code', 'CLAUDE.md'], ['codex', 'AGENTS.md'],
  ['copilot', 'copilot-instructions.md'], ['antigravity', 'GEMINI.md'],
] as const;

describe('personal instructions without persona', () => {
  it.each(layouts)('installs only rules for %s', (harness, file) => {
    const target = workspace(), destination = join(context.root, harness, file);
    installPersonalInstructions(target, harness, false, 'Strict TypeScript; do not invent test results.');
    const initial = readFileSync(destination, 'utf8');
    expect(initial).toContain(INSTRUCTIONS_START);
    expect(initial).not.toMatch(/Henchman identity|cartoon|minion|arch-villain/);
    expect(readPersonalInstructions(workspace(), harness)).toBe('Strict TypeScript; do not invent test results.');
    installPersonalInstructions(target, harness);
    expect(readFileSync(destination, 'utf8')).toBe(initial);
    installPersonalInstructions(target, harness, false, '');
    expect(readFileSync(destination, 'utf8')).not.toContain(INSTRUCTIONS_START);
    expect(JSON.parse(readFileSync(personalSettingsPath(harness), 'utf8'))).toEqual({ projectRules: '' });
  });

  it('preserves user company rules and JSONC provider routing', () => {
    const target = workspace(), root = join(context.root, 'opencode');
    put(join(root, 'AGENTS.md'), 'Company instructions\n');
    const jsonc = '// Provider routing\n{"model":"vertex/gemini","instructions":["~/company.md"],}\n';
    put(join(root, 'opencode.jsonc'), jsonc);
    installPersonalInstructions(target, 'opencode', false, 'Use Conventional Commits.');
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('Company instructions');
    expect(readFileSync(join(root, 'opencode.jsonc'), 'utf8')).toBe(jsonc);
    installPersonalInstructions(target, 'opencode', false, '');
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8').trim()).toBe('Company instructions');
  });

  it('removes both old persona blocks, preserves unowned text and remains idempotent', () => {
    const target = workspace(), path = join(context.root, 'opencode', 'AGENTS.md');
    put(path, 'Header\n<!-- toady:start -->\nCartoon\n<!-- toady:end -->\nMiddle\n<!-- spec-driven-scrum-team:toady:start -->\nOlder\n<!-- spec-driven-scrum-team:toady:end -->\nFooter\n');
    installPersonalInstructions(target, 'opencode', false, 'Keep evidence.');
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('Header');
    expect(text).toContain('Middle');
    expect(text).toContain('Footer');
    expect(text).toContain('Keep evidence.');
    expect(text).not.toContain('Cartoon');
    expect(text).not.toContain('Older');
    expect(text.split(INSTRUCTIONS_START)).toHaveLength(2);
    installPersonalInstructions(target);
    expect(readFileSync(path, 'utf8')).toBe(text);
  });

  it('migrates old enabled persona state but discards its voice flag', () => {
    const target = workspace(), root = join(context.root, 'opencode'), old = join(root, 'toady/persona.json');
    put(old, '{"enabled":true,"projectRules":"No any."}');
    expect(readPersonalInstructions(target)).toBe('No any.');
    installPersonalInstructions(target);
    expect(existsSync(old)).toBe(false);
    expect(JSON.parse(readFileSync(personalSettingsPath('opencode'), 'utf8'))).toEqual({ projectRules: 'No any.' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('No any.');
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).not.toContain('Henchman');
  });

  it('migrates project-local blocks, settings and old file references', () => {
    const target = workspace();
    put(join(target, '.opencode/toady.config.json'), '{"enabled":true,"projectRules":"No any."}');
    put(join(target, '.opencode/personas/toady.md'), '# Toady communication persona\nOld\n');
    put(join(target, 'AGENTS.md'), 'Before\n<!-- spec-driven-scrum-team:toady:start -->\nOld\n<!-- spec-driven-scrum-team:toady:end -->\nAfter');
    for (const name of ['opencode.json', 'opencode.jsonc']) put(join(target, name), '{"instructions":["company.md",".opencode/personas/toady.md"]}');
    installPersonalInstructions(target);
    expect(existsSync(join(target, '.opencode/toady.config.json'))).toBe(false);
    expect(existsSync(join(target, '.opencode/personas/toady.md'))).toBe(false);
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).toContain('Before');
    expect(readFileSync(join(target, 'AGENTS.md'), 'utf8')).not.toContain('Old');
    for (const name of ['opencode.json', 'opencode.jsonc']) expect(parse(readFileSync(join(target, name), 'utf8')).instructions).toEqual(['company.md']);
    expect(readPersonalInstructions(workspace())).toBe('No any.');
  });

  it('removes old global file reference without changing company routing', () => {
    const target = workspace(), root = join(context.root, 'opencode'), old = join(root, 'personas/spec-driven-scrum-team.md');
    put(old, '# Toady communication persona\nOld\n');
    put(join(root, 'opencode.jsonc'), JSON.stringify({ model: 'vertex/gemini', instructions: ['company.md', old.replaceAll('\\', '/')] }));
    installPersonalInstructions(target, 'opencode', false, 'Rules.');
    expect(existsSync(old)).toBe(false);
    const conf = parse(readFileSync(join(root, 'opencode.jsonc'), 'utf8'));
    expect(conf.model).toBe('vertex/gemini');
    expect(conf.instructions).toEqual(['company.md']);
  });

  it('cleans stale Codex blocks in inactive global file', () => {
    const target = workspace(), root = join(context.root, 'codex');
    put(join(root, 'AGENTS.md'), 'Base\n<!-- toady:start -->\nOld\n<!-- toady:end -->');
    put(join(root, 'AGENTS.override.md'), 'Override\n<!-- toady:start -->\nOld\n<!-- toady:end -->');
    installPersonalInstructions(target, 'codex', false, 'Code standards.');
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).not.toContain('Old');
    expect(readFileSync(join(root, 'AGENTS.override.md'), 'utf8')).toContain('Code standards.');
  });

  it('rejects malformed blocks before writing settings', () => {
    const target = workspace(), path = join(context.root, 'opencode', 'AGENTS.md');
    put(path, '<!-- toady:start --> incomplete');
    expect(() => installPersonalInstructions(target, 'opencode', false, 'Rules.')).toThrow('Malformed');
    expect(existsSync(personalSettingsPath('opencode'))).toBe(false);
  });

  it('refuses symlink destinations', () => {
    const target = workspace(), outside = workspace(), root = join(context.root, 'opencode');
    put(join(outside, 'file'), 'Company policy');
    mkdirSync(root);
    symlinkSync(join(outside, 'file'), join(root, 'AGENTS.md'));
    expect(() => installPersonalInstructions(target, 'opencode', false, 'Rules.')).toThrow('symlink');
    expect(readFileSync(join(outside, 'file'), 'utf8')).toBe('Company policy');
  });

  it('preflights without writes and validates rules', () => {
    const target = workspace();
    expect(installPersonalInstructions(target, 'opencode', true, 'Rules.')).toEqual([]);
    expect(existsSync(join(context.root, 'opencode'))).toBe(false);
    expect(() => installPersonalInstructions(context.root, 'opencode', true, 'Rules.')).toThrow('outside');
    const path = join(target, 'rules.md');
    put(path, 'No type assertions.');
    expect(loadPersonalRulesFile(path)).toBe('No type assertions.');
    expect(() => validatePersonalRules('x'.repeat(65537))).toThrow('64 KiB');
    expect(() => validatePersonalRules('<!-- toady:end -->')).toThrow('markers');
    expect(() => loadPersonalRulesFile(join(target, 'bad.json'))).toThrow('Markdown');
  });
});
