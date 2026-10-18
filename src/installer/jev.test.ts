import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ctx = vi.hoisted(() => ({ root: '' }));
import {
  jevSettingsPath, readJevSettings, planJev, writeJevSettings, preflightJev, PROVIDERS,
  type JevProbe, type JevSelection,
} from './jev.js';

let target: string, other: string, originalXdg: string | undefined;
beforeEach(() => {
  ctx.root = mkdtempSync(join(tmpdir(), 'jev-private-'));
  target = join(ctx.root, 'private');
  other = join(ctx.root, 'corporate');
  const fs = requireFs();
  fs.mkdirSync(target);
  fs.mkdirSync(other);
  originalXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(ctx.root, 'user-config');
});
afterEach(() => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  rmSync(ctx.root, { recursive: true, force: true });
});
function requireFs(): typeof import('node:fs') {
  return requireFsValue;
}
import * as requireFsValue from 'node:fs';
const privateChoice: JevSelection = { scope: 'personal', provider: 'zen' };
const workChoice: JevSelection = { scope: 'work', provider: null };

describe('optional project-scoped Jev', () => {
  it('is off by default, with no profile and no probe', () => {
    expect(readJevSettings(target)).toBeNull();
    const calls: string[] = [];
    const probe: JevProbe = () => { calls.push('call'); return true; };
    const result = planJev(workChoice, 'opencode', '', probe);
    expect(result.enabled).toBe(false);
    expect(writeJevSettings(target, result)).toEqual([]);
    expect(calls).toEqual([]);
  });
  it('supports the three fixed decision providers only', () => {
    expect(Object.keys(PROVIDERS)).toEqual(['zen','typesafe','openrouter']);
    expect(PROVIDERS.zen.endpoint).toMatch(/\/systemone$/);
    expect(PROVIDERS.typesafe.model).toMatch(/^jev/);
    expect(PROVIDERS.openrouter.model).toMatch(/jev/);
  });
  it('never calls external service without personal project selection', () => {
    let count = 0;
    const probe: JevProbe = () => { count++; return true; };
    const env = { OPENCODE_API_KEY: 'test-placeholder' };
    const work = planJev({ scope: 'work', provider: 'zen' }, 'opencode', '', probe, env);
    expect(work.enabled).toBe(false);
    expect(count).toBe(0);
  });
  it('requires provider-specific credentials before probing', () => {
    let called = false;
    const result = planJev(privateChoice, 'opencode', '', () => { called = true; return true; }, {});
    expect(result.enabled).toBe(false);
    expect(called).toBe(false);
    expect(result.reason).toContain('credential');
  });
  it('fails closed when the provider does not implement System One', () => {
    const result = planJev(privateChoice, 'opencode', '', () => false, { OPENCODE_API_KEY: 'placeholder' });
    expect(result.enabled).toBe(false);
    expect(result.reason).toContain('capability');
  });
  it('stores only consent metadata for exactly one project and can revoke it', () => {
    const result = planJev(privateChoice, 'opencode', '', () => true, { OPENCODE_API_KEY: 'placeholder' });
    expect(result.enabled).toBe(true);
    expect(writeJevSettings(target, result)).toHaveLength(1);
    expect(readJevSettings(target)).toMatchObject({ enabled: true, scope: 'personal', provider: 'zen' });
    expect(readJevSettings(other)).toBeNull();
    expect(readFileSync(jevSettingsPath(target), 'utf8')).not.toContain('placeholder');
    expect(readFileSync(jevSettingsPath(target), 'utf8')).not.toContain('OPENCODE_API_KEY');
    const off = planJev(workChoice, 'opencode', '', () => { throw new Error('must not call'); });
    expect(writeJevSettings(target, off)).toHaveLength(1);
    expect(readJevSettings(target)?.enabled).toBe(false);
    expect(preflightJev(target)).toBeUndefined();
    expect(existsSync(jevSettingsPath(target))).toBe(true);
  });
});
