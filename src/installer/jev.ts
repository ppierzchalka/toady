import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { checkInstallFile } from './installPaths.js';
function configRoot(): string {
  return resolve(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'toady');
}

export type JevProvider = 'zen' | 'typesafe' | 'openrouter';
export type JevScope = 'work' | 'personal';
export interface JevSelection {
  scope: JevScope;
  provider: JevProvider | null;
}
export interface JevConfig {
  version: 2;
  enabled: boolean;
  scope: 'personal';
  provider: JevProvider;
  model: string;
}
export interface JevResult {
  enabled: boolean;
  reason: string;
  config: JevConfig | null;
  paths: string[];
}
export type JevProbe = (config: JevConfig, runnerPath: string) => boolean;

export const PROVIDERS: Record<JevProvider, { endpoint: string; model: string; keyEnv: string }> = {
  zen: { endpoint: 'https://opencode.ai/zen/v1/systemone', model: 'jev-1.13', keyEnv: 'OPENCODE_API_KEY' },
  typesafe: { endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', keyEnv: 'TYPESAFE_API_KEY' },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/systemone', model: 'typesafe/jev-1.13', keyEnv: 'OPENROUTER_API_KEY' },
};
export function isJevProvider(p: string): p is JevProvider {
  return Object.hasOwn(PROVIDERS, p);
}

/** A project must be classified as personal before any external inference. */
export function jevSettingsPath(targetDir: string): string {
  const canonicalPath = realpathSync(targetDir);
  const hash = createHash('sha256').update(canonicalPath).digest('hex');
  return join(configRoot(), 'decision-gates', hash + '.json');
}
export function readJevSettings(targetDir: string): JevConfig | null {
  const root = configRoot();
  const path = jevSettingsPath(targetDir);
  checkInstallFile(root, path);
  if (!existsSync(path)) return null;
  let data: unknown;
  try { data = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; } // A corrupt optional profile must never block standard installation.
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const cfg = data as Record<string, unknown>;
  if (cfg.version !== 2 || typeof cfg.enabled !== 'boolean' || cfg.scope !== 'personal' ||
    typeof cfg.provider !== 'string' || !isJevProvider(cfg.provider) || cfg.model !== PROVIDERS[cfg.provider].model) {
    return null;
  }
  return cfg as unknown as JevConfig;
}
export function preflightJev(targetDir: string): void {
  checkInstallFile(configRoot(), jevSettingsPath(targetDir));
  readJevSettings(targetDir);
}

/** Probe performs a harmless typed System One request, not a chat completion. */
export function defaultJevProbe(config: JevConfig, runnerPath: string): boolean {
  const result = spawnSync(process.execPath, [runnerPath, '--probe'], {
    input: JSON.stringify(config), encoding: 'utf8', timeout: 20000, maxBuffer: 4096,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (result.status !== 0 || result.error) return false;
  try { return JSON.parse(result.stdout).status === 'ready'; }
  catch { return false; }
}
export function planJev(
  selection: JevSelection,
  harness: string,
  runnerPath: string,
  probe: JevProbe = defaultJevProbe,
  env: NodeJS.ProcessEnv = process.env,
): JevResult {
  if (selection.scope !== 'personal' || !selection.provider) {
    return { enabled: false, reason: 'Jev disabled (work/unsupported harness/not selected)', config: null, paths: [] };
  }
  const choice = PROVIDERS[selection.provider];
  const config: JevConfig = { version: 2, enabled: true, scope: 'personal', provider: selection.provider, model: choice.model };
  if (!env[choice.keyEnv]) return {
    enabled: false, reason: 'Missing credential for selected provider', config: { ...config, enabled: false }, paths: [],
  };
  if (!probe(config, runnerPath)) return {
    enabled: false, reason: 'System One capability check failed', config: { ...config, enabled: false }, paths: [],
  };
  return { enabled: true, reason: 'System One capability verified', config, paths: [] };
}
export function writeJevSettings(targetDir: string, planned: JevResult): string[] {
  preflightJev(targetDir);
  const path = jevSettingsPath(targetDir);
  // Explicit work/disabled selection revokes previously stored permission.
  const cfg = planned.config ?? readJevSettings(targetDir);
  if (!cfg) return [];
  const body = JSON.stringify({ ...cfg, enabled: planned.enabled }, null, 2) + '\n';
  if (existsSync(path) && readFileSync(path, 'utf8') === body) return [];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  return [path];
}
