import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ctx = vi.hoisted(() => ({ root: '' }));
vi.mock('./personalPaths.js', () => ({
  personalConfigRoot: (harness: string) => join(ctx.root, harness),
}));
import {
  isGoJevModel, pickGoJev, readJevSettings, jevSettingsPath,
  probeGoJev, planJev, writeJevSettings,
} from './jev.js';
import type { Probe } from './jev.js';

beforeEach(() => { ctx.root = mkdtempSync(join(tmpdir(), 'jev-')); });
afterEach(() => { rmSync(ctx.root, { recursive: true, force: true }); });

const auth = '● OpenCode Go  api\n';
const catalog = 'opencode-go/jev-1.13\nopencode/jev-1.13\nopencode-go/kimi-k3\n';
const message = JSON.stringify({ type: 'text', part: { type: 'text', text: 'TOADY_JEV_READY' } }) + '\n';
const fake = (result = message): { probe: Probe; calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    probe: (_command, args) => {
      calls.push(args);
      if (args[0] === 'auth') return auth;
      if (args[0] === 'models') return catalog;
      if (args[0] === 'run') return result;
      return '';
    },
  };
};

describe('Go-only optional Jev', () => {
  it('starts disabled without creating a private profile', () => {
    expect(readJevSettings()).toEqual({ version: 1, enabled: false, provider: 'opencode-go', model: null });
    expect(writeJevSettings(planJev(false, 'opencode'))).toEqual([]);
    expect(existsSync(jevSettingsPath())).toBe(false);
  });
  it('requires the exact Go provider ID and authenticated credential', () => {
    expect(isGoJevModel('opencode-go/jev-1.13')).toBe(true);
    for (const other of ['opencode/jev-1.13', 'openai/jev-1.13', 'opencode-go/not-jev', 'opencode-go/jev-1.13/alt']) {
      expect(isGoJevModel(other)).toBe(false);
    }
    expect(pickGoJev(auth, catalog)).toBe('opencode-go/jev-1.13');
    expect(pickGoJev('● OpenCode Zen api', catalog)).toBeNull();
    expect(pickGoJev(auth, 'opencode/jev-1.13')).toBeNull();
  });
  it('never invokes a command with Jev disabled or a non-OpenCode harness', () => {
    const { probe, calls } = fake();
    expect(planJev(false, 'opencode', probe).enabled).toBe(false);
    expect(planJev(true, 'codex', probe).enabled).toBe(false);
    expect(planJev(true, 'antigravity', probe).enabled).toBe(false);
    expect(calls).toEqual([]);
  });
  it('will not probe or enable a model absent from Go, even when Zen has Jev', () => {
    const calls: string[][] = [];
    const probe: Probe = (_cmd, args) => {
      calls.push(args);
      return args[0] === 'auth' ? auth : 'opencode/jev-1.13';
    };
    const config = planJev(true, 'opencode', probe);
    expect(config.enabled).toBe(false);
    expect(calls.map(args => args[0])).toEqual(['auth', 'models']);
  });
  it('fails closed on missing native run capability', () => {
    const { probe, calls } = fake('{"type":"text","part":{"type":"text","text":"Unsupported model"}}');
    const config = planJev(true, 'opencode', probe);
    expect(config.enabled).toBe(false);
    expect(config.reason).toContain('interface');
    expect(calls.at(-1)?.slice(0, 3)).toEqual(['run', '--model', 'opencode-go/jev-1.13']);
  });
  it('rejects a bare success-looking string or non-Go probe', () => {
    expect(probeGoJev('opencode/jev-1.13', fake().probe)).toBe(false);
    expect(probeGoJev('opencode-go/jev-1.13', () => 'TOADY_JEV_READY')).toBe(false);
  });
  it('can persist a proven Go model and disable without probing', () => {
    const { probe, calls } = fake();
    const result = planJev(true, 'opencode', probe);
    expect(result.enabled).toBe(true);
    expect(calls.every(args => !args.some(x => x.includes('opencode/jev-')))).toBe(true);
    expect(writeJevSettings(result)).toHaveLength(1);
    expect(readJevSettings()).toMatchObject({ enabled: true, provider: 'opencode-go', model: 'opencode-go/jev-1.13' });
    expect(writeJevSettings(planJev(false, 'opencode', probe))).toHaveLength(1);
    expect(readJevSettings().enabled).toBe(false);
    expect(readFileSync(jevSettingsPath(), 'utf8')).not.toContain('TOADY_JEV_READY');
    expect(calls).toHaveLength(3);
  });
});
