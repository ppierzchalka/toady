import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';

export interface ModelEntry {
  provider: string;
  model: string;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const CREDENTIAL_ALIASES: Record<string, string[]> = {
  'opencode': ['opencode', 'opencode-go'],
  'opencode-zen': ['opencode'],
  'opencode-console': ['opencode', 'opencode-go'],
  'opencode-go': ['opencode-go'],
};

function addProviderIds(ids: Set<string>, slugOrId: string): void {
  const mapped = CREDENTIAL_ALIASES[slugOrId];
  if (mapped) {
    for (const id of mapped) ids.add(id);
  } else {
    ids.add(slugOrId);
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function stripAnsi(output: string): string {
  return output.replace(ANSI_RE, '');
}

export function parseAuthList(output: string): string[] {
  const ids = new Set<string>();
  for (const raw of stripAnsi(output).split('\n')) {
    const bullet = raw.includes('●') ? raw : undefined;
    if (bullet) {
      const name = bullet
        .replace('●', '')
        .trim()
        .replace(/\s+(api|provider|oauth)$/i, '')
        .trim();
      if (!name) continue;
      addProviderIds(ids, slugify(name));
      continue;
    }
    // OpenCode 2 prints a plain table row per credential: `<Name>  <Type>  stored`.
    const cells = raw.trim().split(/\s{2,}/);
    if (cells.length < 2 || cells[cells.length - 1] !== 'stored') continue;
    const name = cells[0].trim();
    if (!name) continue;
    addProviderIds(ids, slugify(name));
  }
  return [...ids];
}

export function parseAuthExport(output: string): string[] {
  try {
    const value: unknown = JSON.parse(output);
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    for (const entry of value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const integrationID = (entry as { integrationID?: unknown }).integrationID;
      if (typeof integrationID !== 'string' || !integrationID) continue;
      addProviderIds(ids, integrationID);
    }
    return [...ids];
  } catch {
    return [];
  }
}

export function parseModels(output: string): ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const line of stripAnsi(output).split('\n')) {
    const match = line.trim().match(/^([\w.-]+)\/([\w.-]+)$/);
    if (match) {
      entries.push({ provider: match[1], model: match[2] });
    }
  }
  return entries;
}

export function availableModels(
  authListOutput: string,
  modelsOutput: string,
  extraProviders: string[] = [],
  authExportOutput = '',
): string[] {
  const authed = new Set([
    ...parseAuthList(authListOutput),
    ...parseAuthExport(authExportOutput),
    ...extraProviders,
  ]);
  return parseModels(modelsOutput)
    .filter((entry) => authed.has(entry.provider))
    .map((entry) => `${entry.provider}/${entry.model}`);
}

const ENV_PROVIDER_KEYS: Record<string, string[]> = {
  OPENAI_API_KEY: ['openai'],
  OPENCODE_API_KEY: ['opencode', 'opencode-go'],
  ANTHROPIC_API_KEY: ['anthropic'],
  GOOGLE_API_KEY: ['google', 'google-vertex'],
  GEMINI_API_KEY: ['google'],
  DEEPSEEK_API_KEY: ['deepseek'],
  META_MODEL_API_KEY: ['meta'],
  GROQ_API_KEY: ['groq'],
  OPENROUTER_API_KEY: ['openrouter'],
  XAI_API_KEY: ['xai'],
  MISTRAL_API_KEY: ['mistral'],
  GITHUB_API_KEY: ['github-copilot'],
};

export function detectEnvProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  const providers = new Set<string>();
  for (const [key, ids] of Object.entries(ENV_PROVIDER_KEYS)) {
    if (env[key]) {
      for (const id of ids) providers.add(id);
    }
  }
  return [...providers];
}

export function defaultConfigPaths(): string[] {
  const configDir = join(homedir(), '.config', 'opencode');
  return [join(configDir, 'opencode.json'), join(configDir, 'opencode.jsonc'), join(configDir, 'config.json')];
}

export function detectConfigProviders(paths: string[] = defaultConfigPaths()): string[] {
  const providers = new Set<string>();
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const config = parseJsonc(readFileSync(path, 'utf8')) as {
        provider?: Record<string, { options?: { apiKey?: unknown } }>;
      };
      for (const [id, def] of Object.entries(config?.provider ?? {})) {
        if (def?.options?.apiKey) providers.add(id);
      }
    } catch {
      // skip unparseable config files
    }
  }
  return [...providers];
}

const EFFORT_BY_PROVIDER: Record<string, string[]> = {
  google: ['minimal', 'low', 'medium', 'high'],
  openai: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  deepseek: ['none', 'low', 'medium', 'high'],
  anthropic: ['none', 'high', 'max'],
};

const EFFORT_BY_MODEL: Record<string, string[]> = {
  'openai/gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'openai/gpt-5.6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'opencode-go/glm-5.2': ['high', 'max'],
  'opencode/glm-5.2': ['high', 'max'],
};

export function deriveEffortLevels(provider: string, model?: string): string[] {
  if (model && EFFORT_BY_MODEL[model]) return EFFORT_BY_MODEL[model];
  return EFFORT_BY_PROVIDER[provider] ?? ['none', 'low', 'medium', 'high'];
}
