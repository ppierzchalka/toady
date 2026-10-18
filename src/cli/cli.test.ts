import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { symlinkSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import { installerPaths, resolvePackageRoot } from './assets.js';
import { readBuildInfo } from './buildInfo.js';

describe('single-cwd CLI arguments', () => {
  it('parses the supported flags', () => {
    expect(parseArgs(['--defaults', '--harness=codex', '--replace-skills'])).toMatchObject({
      defaults: true,
      harnessName: 'codex',
      replaceSkills: true,
    });
    expect(parseArgs(['-d', '--clear-additional-rules'])).toMatchObject({ defaults: true, clearRules: true });
    expect(parseArgs(['--additional-rules=r.md'])).toMatchObject({ rulesFlag: 'r.md' });
    expect(parseArgs([])).toMatchObject({ defaults: false, help: false, jev: undefined });
    expect(parseArgs(['--defaults', '--jev', '--jev-scope=personal', '--jev-provider=zen'])).toMatchObject({ defaults: true, jev: true, jevScope: 'personal', jevProvider: 'zen' });
    expect(parseArgs(['--defaults', '--no-jev'])).toMatchObject({ defaults: true, jev: false });
    expect(() => parseArgs(['--jev'])).toThrow(/explicit/);
    expect(() => parseArgs(['--jev-provider=zen'])).toThrow(/requires --jev/);
  });

  it('rejects positional targets with an actionable message', () => {
    expect(() => parseArgs(['../repo-a'])).toThrow(/only in the invocation directory/);
    expect(() => parseArgs(['--defaults', '/tmp/x'])).toThrow(/only in the invocation directory/);
  });

  it('rejects removed multi-target usage instead of ignoring it', () => {
    expect(() => parseArgs(['a', 'b'])).toThrow(/Multi-target installs were removed/);
  });

  it('rejects malformed and conflicting flags before any writes', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown flag/);
    expect(() => parseArgs(['--jev', '--no-jev'])).toThrow(/Choose --jev or --no-jev/);
    expect(() => parseArgs(['--toady'])).toThrow(/Unknown flag/);
    expect(() => parseArgs(['--additional-rules=a', '--additional-rules=b'])).toThrow(/one additional rules file/i);
    expect(() => parseArgs(['--additional-rules=a', '--clear-additional-rules'])).toThrow(/or clear rules/);
    expect(() => parseArgs(['--harness=a', '--harness=b'])).toThrow(/single --harness/);
  });
});

describe('packaged asset resolution', () => {
  it('resolves the package root from nested dist output, not from cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'pkg-root-'));
    try {
      mkdirSync(join(root, 'dist'), { recursive: true });
      mkdirSync(join(root, 'agents'), { recursive: true });
      mkdirSync(join(root, 'skills/autonomous-implement'), { recursive: true });
      writeFileSync(join(root, 'package.json'), '{"name":"x"}');
      writeFileSync(join(root, 'skills/autonomous-implement/SKILL.md'), '# skill');
      const nested = pathToFileURL(join(root, 'dist', 'cli', 'cli.js')).href;
      expect(resolvePackageRoot(nested)).toBe(root);
      const paths = installerPaths(root);
      expect(paths.definitionsDir).toBe(join(root, 'agents'));
      expect(paths.skillDir).toBe(join(root, 'skills/autonomous-implement'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws when runtime assets are missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pkg-missing-'));
    try {
      expect(() => resolvePackageRoot(pathToFileURL(join(root, 'cli.js')).href)).toThrow(/installer assets/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a dev identity without a build stamp', () => {
    const root = mkdtempSync(join(tmpdir(), 'pkg-dev-'));
    try {
      writeFileSync(join(root, 'package.json'), '{"version":"0.1.0"}');
      expect(readBuildInfo(root)).toMatchObject({ version: '0.1.0', commit: 'dev', tag: '0.1.0+dev' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('exact-build pin (validated handoff)', () => {
  function runCli(target: string, env: NodeJS.ProcessEnv, args: string[]): { status: number; stdout: string; stderr: string } {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    try {
      const stdout = execFileSync(process.execPath, ['--import', 'tsx', join(repoRoot, 'src/cli.ts'), ...args], {
        cwd: target,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        timeout: 120000,
      });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stdout?: unknown; stderr?: unknown };
      return { status: failure.status ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '') };
    }
  }

  function targetWithLoader(): string {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const target = mkdtempSync(join(tmpdir(), 'cli-pin-'));
    symlinkSync(join(repoRoot, 'node_modules'), join(target, 'node_modules'), 'dir');
    return target;
  }

  it('aborts when the pin does not match the local stamp', () => {
    const target = targetWithLoader();
    try {
      const result = runCli(target, { ...process.env, TERM: 'xterm', TOADY_EXACT_BUILD: '0'.repeat(40) }, ['--help']);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/does not match pinned build/);
      expect(existsSync(join(target, '.opencode'))).toBe(false);
      expect(existsSync(join(target, '.vscode'))).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('accepts the legacy pin name as a fallback', () => {
    const target = targetWithLoader();
    try {
      const result = runCli(target, { ...process.env, TERM: 'xterm', INSTALL_TEAM_EXACT_BUILD: '0'.repeat(40) }, ['--help']);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/does not match pinned build/);
      expect(existsSync(join(target, '.opencode'))).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('runs when the pin matches the local stamp', () => {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const target = targetWithLoader();
    try {
      const own = readBuildInfo(repoRoot);
      const result = runCli(target, { ...process.env, TERM: 'xterm', TOADY_EXACT_BUILD: own.commit }, ['--help']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('current directory');
      expect(result.stdout).toContain(`build ${own.tag}`);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

describe('toady identity and bin alias', () => {
  it('presents Toady with the supported install-team alias', async () => {
    const { USAGE } = await import('./args.js');
    expect(USAGE).toContain('toady — configure Toady');
    expect(USAGE).toContain('install-team remains an equivalent supported alias');
    expect(USAGE).not.toContain('Spec-Driven Scrum Team');
    const pkg = JSON.parse(readFileSync(join(fileURLToPath(new URL('../../', import.meta.url)), 'package.json'), 'utf8')) as { name: string; bin: Record<string, string> };
    expect(pkg.name).toBe('toady');
    expect(pkg.bin.toady).toBe('./dist/cli/launch.js');
    expect(pkg.bin['install-team']).toBe('./dist/cli/launch.js');
  });
});

describe('interactive startup guards', () => {
  it('exits with usage and no writes when stdin is not a TTY', () => {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const target = mkdtempSync(join(tmpdir(), 'cli-nontty-'));
    try {
      // Resolve the dev loader from the throwaway cwd like a real consumer run.
      symlinkSync(join(repoRoot, 'node_modules'), join(target, 'node_modules'), 'dir');
      let status = 0;
      let stderr = '';
      try {
        execFileSync(process.execPath, ['--import', 'tsx', join(repoRoot, 'src/cli.ts'), '--harness=opencode'], {
          cwd: target,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, TERM: 'xterm' },
        });
      } catch (error) {
        status = (error as { status?: number }).status ?? 1;
        stderr = String((error as { stderr?: unknown }).stderr ?? error);
      }
      expect(status).toBe(2);
      expect(stderr).toContain('not a TTY');
      expect(existsSync(join(target, '.opencode'))).toBe(false);
      expect(existsSync(join(target, '.vscode'))).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

describe('stamped release identity', () => {

  it('reports the stamped identity of release builds', () => {
    const root = mkdtempSync(join(tmpdir(), 'pkg-stamp-'));
    try {
      writeFileSync(join(root, 'package.json'), '{"version":"0.1.0"}');
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/build-info.json'), JSON.stringify({ commit: 'abc1234567890abcdef', builtAt: '2026-10-09' }));
      expect(readBuildInfo(root)).toMatchObject({ version: '0.1.0', commit: 'abc1234567890abcdef', tag: '0.1.0+abc123456789' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
