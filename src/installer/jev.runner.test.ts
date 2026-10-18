import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planJev, writeJevSettings } from './jev.js';

const runner = fileURLToPath(new URL('../../skills/decision-gates/scripts/judge.mjs', import.meta.url));
let root: string;
let personal: string;
let work: string;
let xdg: string;
let mockModule: string;
let prior: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toady-gates-runtime-'));
  personal = join(root, 'private');
  work = join(root, 'corporate');
  xdg = join(root, 'user-config');
  mkdirSync(personal);
  mkdirSync(work);
  prior = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  mockModule = join(root, 'mock-fetch.mjs');
  writeFileSync(mockModule, [
    "globalThis.fetch = async (url, init) => {",
    "  if (url !== 'https://opencode.ai/zen/v1/systemone' || init.method !== 'POST') throw new Error('Unexpected external endpoint');",
    "  const request = JSON.parse(init.body);",
    "  if (request.model !== 'jev-1.13' || request.questions?.verdict?.type !== 'choice') throw new Error('Not a typed Jev request');",
    "  return { ok: true, text: async () => JSON.stringify({",
    "    model: 'jev-1.13',",
    "    answers: { verdict: { type: 'choice', choice: 'pass', confidence: 0.93 } }",
    "  }) };",
    "};"
  ].join('\n'));
});
afterEach(() => {
  if (prior === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prior;
  rmSync(root, { recursive: true, force: true });
});

const input = JSON.stringify({
  goal: 'Work according to the accepted contract',
  criteria: ['Output is verified'],
  evidence: ['Test passed on commit abc123'],
  proposedDecision: 'Mark ready for review',
});
function invoke(cwd: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ['--import', mockModule, runner, ...args], {
    cwd, encoding: 'utf8', input, timeout: 5000,
    env: { ...process.env, XDG_CONFIG_HOME: xdg, ...env },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}
describe('decision runner isolation', () => {
  it('never invokes external provider for a work or unconfigured project', () => {
    expect(invoke(work, ['outcome'], { OPENCODE_API_KEY: 'fake' }).status).toBe('skipped');
  });
  it('uses real typed choice System One schema only for the opted-in project', () => {
    const planned = planJev({ scope: 'personal', provider: 'zen' }, 'opencode', runner,
      () => true, { OPENCODE_API_KEY: 'fake' });
    expect(planned.enabled).toBe(true);
    writeJevSettings(personal, planned);
    const verdict = invoke(personal, ['outcome'], { OPENCODE_API_KEY: 'fake' });
    expect(verdict).toMatchObject({ status: 'pass', provider: 'zen', confidence: 0.93 });
    expect(invoke(work, ['outcome'], { OPENCODE_API_KEY: 'fake' }).status).toBe('skipped');
  });
  it('stops on provider opt-out and missing credentials without fallback', () => {
    const planned = planJev({ scope: 'personal', provider: 'zen' }, 'opencode', runner,
      () => true, { OPENCODE_API_KEY: 'fake' });
    writeJevSettings(personal, planned);
    expect(invoke(personal, ['outcome'], { OPENCODE_API_KEY: '' }).status).toBe('skipped');
    writeJevSettings(personal, planJev({ scope: 'work', provider: null }, 'opencode', runner));
    expect(invoke(personal, ['outcome'], { OPENCODE_API_KEY: 'fake' }).status).toBe('skipped');
  });
  it('uses the probe without a project profile and requires a typed response', () => {
    const config = { version: 2, enabled: true, scope: 'personal', provider: 'zen', model: 'jev-1.13' };
    const result = spawnSync(process.execPath, ['--import', mockModule, runner, '--probe'], {
      cwd: work, encoding: 'utf8', input: JSON.stringify(config), timeout: 5000,
      env: { ...process.env, OPENCODE_API_KEY: 'fake', XDG_CONFIG_HOME: xdg },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('ready');
  });
});
