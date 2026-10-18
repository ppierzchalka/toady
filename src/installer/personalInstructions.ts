import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { HARNESS_LAYOUTS, type Harness } from './harness.js';
import { checkInstallFile } from './installPaths.js';
import { personalConfigRoot } from './personalPaths.js';

/** Only user-authored instructions are installed. No role-play or default voice. */
export const INSTRUCTIONS_START = '<!-- toady:instructions:start -->';
export const INSTRUCTIONS_END = '<!-- toady:instructions:end -->';
const OLD_BLOCKS = [
  ['<!-- toady:start -->', '<!-- toady:end -->'],
  ['<!-- spec-driven-scrum-team:toady:start -->', '<!-- spec-driven-scrum-team:toady:end -->'],
] as const;
const BLOCKS: readonly (readonly [string, string])[] = [
  [INSTRUCTIONS_START, INSTRUCTIONS_END],
  ...OLD_BLOCKS,
];
const OLD_PROJECT_REFERENCE = '.opencode/personas/toady.md';
const nativeFiles: Record<Exclude<Harness, 'opencode'>, string> = {
  'claude-code': 'CLAUDE.md',
  codex: 'AGENTS.md',
  copilot: 'copilot-instructions.md',
  antigravity: 'GEMINI.md',
};
const oldProjectFiles: Record<Harness, string> = {
  opencode: 'AGENTS.md',
  'claude-code': 'CLAUDE.md',
  codex: 'AGENTS.md',
  copilot: '.github/copilot-instructions.md',
  antigravity: '.agents/rules/toady.md',
};

export function legacyRepoStatePath(harness: Harness): string {
  return dirname(HARNESS_LAYOUTS[harness].config) + '/toady.config.json';
}

export function personalSettingsPath(harness: Harness): string {
  return join(personalConfigRoot(harness), 'toady', 'instructions.json');
}

function oldSettingsPaths(harness: Harness): string[] {
  const root = personalConfigRoot(harness);
  return [join(root, 'toady', 'persona.json'), join(root, 'spec-driven-scrum-team', 'persona.json')];
}

export function validatePersonalRules(rules: string): string {
  if (Buffer.byteLength(rules, 'utf8') > 65536) throw new Error('Personal instructions must be at most 64 KiB');
  if (BLOCKS.some(([start, end]) => rules.includes(start) || rules.includes(end))) {
    throw new Error('Personal instructions cannot contain managed block markers');
  }
  return rules;
}

export function loadPersonalRulesFile(path: string): string {
  if (!/\.(md|txt)$/i.test(path)) throw new Error('Select a Markdown or text rules file');
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 65536) throw new Error('Personal instructions source must be a regular file of at most 64 KiB');
  return validatePersonalRules(readFileSync(path, 'utf8'));
}

function rulesAt(path: string): string {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid personal instructions settings');
  const state = value as Record<string, unknown>;
  if ((state.projectRules !== undefined && typeof state.projectRules !== 'string') ||
      (state.enabled !== undefined && typeof state.enabled !== 'boolean')) {
    throw new Error('Invalid personal instructions settings');
  }
  return validatePersonalRules(typeof state.projectRules === 'string' ? state.projectRules : '');
}

/** Read new settings first, then historic private/project state. Ignore obsolete voice flags. */
export function readPersonalInstructions(targetDir: string, harness: Harness = 'opencode'): string {
  const root = personalConfigRoot(harness);
  for (const path of [personalSettingsPath(harness), ...oldSettingsPaths(harness)]) {
    checkInstallFile(root, path);
    if (existsSync(path)) return rulesAt(path);
  }
  const legacy = join(targetDir, legacyRepoStatePath(harness));
  checkInstallFile(targetDir, legacy);
  return existsSync(legacy) ? rulesAt(legacy) : '';
}

interface PendingFile { path: string; body: string }

function locateBlock(source: string, start: string, end: string): { first: number; last: number } | null {
  const first = source.indexOf(start), last = source.indexOf(end);
  if (first < 0 && last < 0) return null;
  if ((first < 0) !== (last < 0) ||
      (first >= 0 && (last < first || source.indexOf(start, first + start.length) >= 0 ||
      source.indexOf(end, last + end.length) >= 0))) {
    throw new Error('Malformed managed instruction block; existing instructions unchanged');
  }
  return { first, last: last + end.length };
}

/** Replace all owned generations in place, preserving every unowned byte. */
function managedBlock(source: string, replacement: string): string {
  const matches = BLOCKS.map(([start, end]) => locateBlock(source, start, end)).filter(
    (match): match is { first: number; last: number } => match !== null,
  ).sort((a, b) => a.first - b.first);
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].first < matches[i - 1].last) {
      throw new Error('Malformed overlapping managed instruction blocks; existing instructions unchanged');
    }
  }
  if (!matches.length) {
    return replacement ? source + (source && !source.endsWith('\n') ? '\n' : '') + '\n' + replacement + '\n' : source;
  }
  let result = source, first = true;
  for (const match of [...matches].reverse()) {
    const body = match === matches[0] ? replacement : '';
    result = result.slice(0, match.first) + body + result.slice(match.last);
    first = false;
  }
  return result;
}

function removeConfigReference(path: string, reference: string): PendingFile | undefined {
  const source = readFileSync(path, 'utf8');
  const errors: ParseError[] = [];
  const config = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid OpenCode configuration: ' + path);
  }
  if (config.instructions !== undefined &&
      (!Array.isArray(config.instructions) || !config.instructions.every((value: unknown) => typeof value === 'string'))) {
    throw new Error('OpenCode instructions must be a string array');
  }
  if (!config.instructions?.includes(reference)) return undefined;
  const entries: string[] = config.instructions.filter((entry: string) => entry !== reference);
  return {
    path,
    body: applyEdits(source, modify(source, ['instructions'], entries.length ? entries : undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
    })),
  };
}

/**
 * Preflight all paths before any writes. An empty ruleset only removes owned
 * legacy content; existing company/project instructions remain untouched.
 */
export function installPersonalInstructions(
  targetDir: string,
  harness: Harness = 'opencode',
  dryRun = false,
  projectRules?: string,
): string[] {
  const rules = validatePersonalRules(projectRules ?? readPersonalInstructions(targetDir, harness));
  const root = personalConfigRoot(harness);
  const rel = relative(targetDir, root);
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\')) {
    throw new Error('Personal configuration must be outside the target repository');
  }

  const pending = new Map<string, string>();
  const remove = new Set<string>();
  const put = (path: string, body: string, base = root): void => {
    checkInstallFile(base, path);
    pending.set(path, body);
  };
  const replacement = rules.trim()
    ? INSTRUCTIONS_START + '\n' + '# Personal instructions\n\n' + rules.trim() + '\n' + INSTRUCTIONS_END
    : '';

  const override = join(root, 'AGENTS.override.md');
  if (harness === 'codex') checkInstallFile(root, override);
  const selected = harness === 'opencode' ? join(root, 'AGENTS.md') :
    harness === 'codex' && existsSync(override) ? override : join(root, nativeFiles[harness]);
  // Also retire stale Codex instructions in the inactive global file.
  const globalPaths = harness === 'codex' ? [selected, selected === override ? join(root, 'AGENTS.md') : override] : [selected];
  for (const path of globalPaths) {
    checkInstallFile(root, path);
    const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const updated = managedBlock(source, path === selected ? replacement : '');
    if (updated !== source) put(path, updated);
  }

  if (harness === 'opencode') {
    const oldGlobal = join(root, 'personas', 'spec-driven-scrum-team.md');
    checkInstallFile(root, oldGlobal);
    for (const file of ['opencode.json', 'opencode.jsonc']) {
      const config = join(root, file);
      checkInstallFile(root, config);
      if (existsSync(config)) {
        const edit = removeConfigReference(config, oldGlobal.replaceAll('\\', '/'));
        if (edit) put(edit.path, edit.body);
      }
    }
    if (existsSync(oldGlobal)) {
      const body = readFileSync(oldGlobal, 'utf8');
      if (body.startsWith('# Toady communication persona\n') || body.startsWith('# Project startup instructions\n')) {
        remove.add(oldGlobal);
      }
    }
  }

  const current = personalSettingsPath(harness);
  put(current, JSON.stringify({ projectRules: rules }, null, 2) + '\n');

  for (const old of oldSettingsPaths(harness)) {
    checkInstallFile(root, old);
    if (existsSync(old)) {
      rulesAt(old); // Reject corrupt legacy state before any mutation.
      remove.add(old);
    }
  }
  const legacyState = join(targetDir, legacyRepoStatePath(harness));
  checkInstallFile(targetDir, legacyState);
  if (existsSync(legacyState)) {
    rulesAt(legacyState);
    remove.add(legacyState);
  }
  const projectCandidates = [join(targetDir, oldProjectFiles[harness])];
  if (harness === 'codex') projectCandidates.push(join(targetDir, 'AGENTS.override.md'));
  for (const path of projectCandidates) {
    checkInstallFile(targetDir, path);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    const updated = managedBlock(source, '');
    if (updated !== source) put(path, updated, targetDir);
  }
  if (harness === 'opencode') {
    for (const file of ['opencode.json', 'opencode.jsonc']) {
      const path = join(targetDir, file);
      checkInstallFile(targetDir, path);
      if (!existsSync(path)) continue;
      const edit = removeConfigReference(path, OLD_PROJECT_REFERENCE);
      if (edit) put(edit.path, edit.body, targetDir);
    }
    const oldPersona = join(targetDir, OLD_PROJECT_REFERENCE);
    checkInstallFile(targetDir, oldPersona);
    if (existsSync(oldPersona)) {
      const content = readFileSync(oldPersona, 'utf8');
      if (content.startsWith('# Toady communication persona\n') || content.startsWith('# Project startup instructions\n')) {
        remove.add(oldPersona);
      }
    }
  }

  if (dryRun) return [];
  for (const [path, body] of pending) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, { mode: 0o600 });
  }
  for (const path of remove) unlinkSync(path);
  return [...pending.keys()];
}
