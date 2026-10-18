import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkInstallFile } from './installPaths.js';
import { personalConfigRoot } from './personalPaths.js';
import { parseAuthList, parseModels } from './model-catalog.js';

export interface JevConfig {
  version: 1;
  enabled: boolean;
  provider: 'opencode-go';
  model: string | null;
}
export interface JevResult {
  enabled: boolean;
  reason: string;
  model: string | null;
  paths: string[];
}
export type Probe = (command: string, args: string[]) => string;
const GO_JEV = /^opencode-go\/jev(?:[-.][a-z0-9.-]+)?$/;
const DISABLED: JevConfig = { version: 1, enabled: false, provider: 'opencode-go', model: null };

export function jevSettingsPath(): string {
  return join(personalConfigRoot('opencode'), 'toady', 'decision-gates.json');
}
export function isGoJevModel(model: string): boolean {
  return GO_JEV.test(model);
}
export function pickGoJev(authOutput: string, modelsOutput: string): string | null {
  if (!parseAuthList(authOutput).includes('opencode-go')) return null;
  const goModels = parseModels(modelsOutput)
    .map(({ provider, model }) => provider + '/' + model)
    .filter(isGoJevModel);
  return goModels.find(m => /^opencode-go\/jev-\d/.test(m)) ?? goModels[0] ?? null;
}
export function readJevSettings(): JevConfig {
  const path = jevSettingsPath();
  checkInstallFile(personalConfigRoot('opencode'), path);
  if (!existsSync(path)) return { ...DISABLED };
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Jev settings');
  const data = raw as Record<string, unknown>;
  if (data.version !== 1 || typeof data.enabled !== 'boolean' || data.provider !== 'opencode-go' ||
      (data.model !== null && (typeof data.model !== 'string' || !isGoJevModel(data.model)))) {
    throw new Error('Invalid Jev settings: only OpenCode Go Jev is allowed');
  }
  if (data.enabled && typeof data.model !== 'string') throw new Error('Enabled Jev requires a Go model');
  return { version: 1, enabled: data.enabled, provider: 'opencode-go', model: data.model as string | null };
}
export function defaultProbe(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}
/** Explicit probe costs one tiny inference and never asks a non-Go provider. */
export function probeGoJev(model: string, probe: Probe = defaultProbe): boolean {
  if (!isGoJevModel(model)) return false;
  const output = probe('opencode', ['run', '--model', model, '--format', 'json',
    'Capability check. Reply with exactly TOADY_JEV_READY and nothing else. Do not call tools.']);
  if (!output) return false;
  // OpenCode run --format json emits newline-delimited events, not a bare model string.
  return output.split(/\r?\n/).some(line => {
    try {
      const data: unknown = JSON.parse(line);
      if (!data || typeof data !== 'object') return false;
      const event = data as { type?: string; part?: { type?: string; text?: string } };
      return event.type === 'text' && event.part?.type === 'text' &&
        event.part.text?.trim() === 'TOADY_JEV_READY';
    } catch { return false; }
  });
}
export function discoverGoJev(probe: Probe = defaultProbe): string | null {
  const auth = probe('opencode', ['auth', 'list']);
  const models = probe('opencode', ['models', 'opencode-go']);
  return pickGoJev(auth, models);
}
/**
 * A missing subscription, unauthorized harness or failing probe always results
 * in disabled state. Existing installations can be disabled without probing.
 * Validation occurs before project writes; the private setting is persisted last.
 */
export function planJev(requested: boolean, harness: string, probe: Probe = defaultProbe): JevResult {
  if (harness !== 'opencode') return { enabled: false, model: null, reason: 'Jev is OpenCode Go only', paths: [] };
  if (!requested) return { enabled: false, model: null, reason: 'Disabled by user', paths: [] };
  const model = discoverGoJev(probe);
  if (!model) return { enabled: false, model: null, reason: 'No authenticated OpenCode Go Jev model', paths: [] };
  if (!probeGoJev(model, probe)) return { enabled: false, model: null, reason: 'Go Jev does not support the OpenCode run interface', paths: [] };
  return { enabled: true, model, reason: 'Native Go Jev probe succeeded', paths: [] };
}
export function preflightJev(): void {
  const path = jevSettingsPath();
  checkInstallFile(personalConfigRoot('opencode'), path);
  readJevSettings();
}
export function writeJevSettings(result: JevResult): string[] {
  preflightJev();
  const path = jevSettingsPath();
  const config: JevConfig = { version: 1, enabled: result.enabled, provider: 'opencode-go', model: result.enabled ? result.model : null };
  const body = JSON.stringify(config, null, 2) + '\n';
  if (existsSync(path) && readFileSync(path, 'utf8') === body) return [];
  // Do not create any Jev config when it was never opted in.
  if (!result.enabled && !existsSync(path)) return [];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  return [path];
}
