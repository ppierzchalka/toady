import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAll, preflightAll } from './installAll.js';

const source = fileURLToPath(new URL('../../', import.meta.url));
const privateContext = vi.hoisted(() => ({ root: '' }));
vi.mock('./personalPaths.js', () => ({ personalConfigRoot: (harness: string) => join(privateContext.root, 'user', harness) }));

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'team-install-all-'));
  roots.push(root);
  privateContext.root = root;
  const targetDir = join(root, 'target');
  mkdirSync(targetDir);
  return {
    targetDir,
    plan: {
      options: {
        targetDir,
        config: {},
        definitionsDir: join(source, 'agents'),
        skillDir: join(source, 'skills/autonomous-implement'),
        harness: 'opencode' as const,
        replaceSkills: true,
      },
      instructions: 'No any.',
    },
  };
}

describe('single-cwd installation', () => {
  it('writes team files, private instructions and VS Code settings', () => {
    const { targetDir, plan } = fixture();
    const result = installAll(plan);
    expect(result.target).toBe(targetDir);
    expect(existsSync(join(targetDir, '.opencode/agents/analyst.md'))).toBe(true);
    expect(existsSync(join(targetDir, '.opencode/team.config.json'))).toBe(true);
    expect(existsSync(join(targetDir, '.gitignore'))).toBe(true);
    expect(result.instructionsPaths.length).toBeGreaterThan(0);
    expect(readFileSync(join(privateContext.root, 'user/opencode/AGENTS.md'), 'utf8')).toContain('No any.');
    expect(result.vscode.status).toBe('wrote');
    expect(readFileSync(join(targetDir, '.vscode/settings.json'), 'utf8')).toContain('-workbench.action.quickOpen');
  });

  it('keeps an already-configured VS Code file and reports kept', () => {
    const { plan } = fixture();
    installAll(plan);
    const second = installAll(plan);
    expect(second.vscode.status).toBe('kept');
  });

  it('validates every scope before the first write: broken team tree blocks instructions and editor writes', () => {
    const { targetDir, plan } = fixture();
    mkdirSync(join(targetDir, '.opencode/skills'), { recursive: true });
    symlinkSync(join(source, 'package.json'), join(targetDir, '.opencode/skills/autonomous-implement'));
    expect(() => installAll(plan)).toThrow();
    expect(existsSync(join(targetDir, '.opencode/agents'))).toBe(false);
    expect(existsSync(join(privateContext.root, 'user'))).toBe(false);
    expect(existsSync(join(targetDir, '.vscode'))).toBe(false);
  });

  it('validates the editor scope before team writes: invalid settings.json blocks everything', () => {
    const { targetDir, plan } = fixture();
    mkdirSync(join(targetDir, '.vscode'), { recursive: true });
    writeFileSync(join(targetDir, '.vscode/settings.json'), '{invalid');
    expect(() => preflightAll(plan)).toThrow(/Invalid VS Code settings JSONC/);
    expect(() => installAll(plan)).toThrow(/Invalid VS Code settings JSONC/);
    expect(existsSync(join(targetDir, '.opencode'))).toBe(false);
    expect(existsSync(join(privateContext.root, 'user'))).toBe(false);
    expect(readFileSync(join(targetDir, '.vscode/settings.json'), 'utf8')).toBe('{invalid');
  });

  it('reports partial-installation truthfully when a late scope fails', () => {
    const { targetDir, plan } = fixture();
    // Preflight only stats destinations, so revoking write permission makes
    // the team writer fail after validation passed.
    chmodSync(targetDir, 0o555);
    try {
      expect(() => installAll(plan)).toThrow(/partially written/);
    } finally {
      chmodSync(targetDir, 0o755);
    }
  });
});
