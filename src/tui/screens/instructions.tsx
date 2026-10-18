import React from 'react';
import { Box, Text } from 'ink';
import { dirname, join, resolve } from 'node:path';
import { lstatSync, readdirSync } from 'node:fs';
import { loadPersonalRulesFile } from '../../installer/personalInstructions.js';
import type { Action, SessionState } from '../state.js';
import type { MenuItem } from '../components/controls.js';
import { EditActions, MenuList, TextField } from '../components/controls.js';
import { wrapLines } from '../layout.js';
import { palette } from '../theme.js';

export interface BrowserEntry {
  id: string;
  label: string;
  isDirectory: boolean;
}

/**
 * Native rules-file browser entries for a directory: parent first, then
 * directories, then eligible .md/.txt files. Pure except for the directory
 * read, which reports errors as data so empty/unreadable folders stay
 * recoverable. Throws nothing.
 */
export function browserEntries(dir: string, showHidden: boolean): { entries: BrowserEntry[]; error: string | null } {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error.message : 'Cannot read directory' };
  }
  const dirs: BrowserEntry[] = [];
  const files: BrowserEntry[] = [];
  for (const name of names.sort()) {
    if (!showHidden && name.startsWith('.')) continue;
    const path = join(dir, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) dirs.push({ id: path, label: `${name}/`, isDirectory: true });
    else if (stat.isFile() && /\.(md|txt)$/i.test(name)) files.push({ id: path, label: name, isDirectory: false });
  }
  return { entries: [{ id: '..', label: '.. (parent)', isDirectory: true }, ...dirs, ...files], error: null };
}

export function instructionsFocusIds(state: SessionState, entries: BrowserEntry[]): string[] {
  if (state.rulesBrowser.open) {
    return [...entries.map((entry) => entry.id), '__hidden__', '__cancel__'];
  }
  return ['rules-browse', 'rules-path', 'rules-clear', '__next__', '__back__', 'jev'];
}

export function instructionsBrowserItems(entries: BrowserEntry[], showHidden: boolean): MenuItem[] {
  return [
    ...entries.map((entry) => ({ id: entry.id, label: entry.label, hint: entry.isDirectory ? undefined : 'Markdown/text rules file' })),
    { id: '__hidden__', label: showHidden ? 'Hide hidden entries' : 'Show hidden entries' },
    { id: '__cancel__', label: 'Cancel (keep prior rules)' },
  ];
}

export function instructionsItems(state: SessionState): MenuItem[] {
  return [
    { id: 'rules-browse', label: 'Browse for a rules file', hint: 'navigate folders; Markdown/text files' },
    { id: 'rules-path', label: 'Enter a rules file path', hint: 'relative to the installation directory, or absolute' },
    { id: 'rules-clear', label: 'Clear additional rules', hint: 'leave existing repository conventions unchanged' },
    { id: '__next__', label: 'Next: review and install' },
    { id: '__back__', label: 'Back to agents and models' },
    { id: 'jev', label: 'Jev decision gates (OpenCode Go only)',
      hint: state.harness !== 'opencode' ? 'unavailable for this harness' :
        !state.discovery.models.some(m => /^opencode-go\\/jev(?:[-.][a-z0-9.-]+)?$/.test(m)) ? 'unavailable; no authenticated Go Jev model detected' :
        state.jevRequested ? 'requested; capability tested before install' : 'off (optional)',
      state: state.harness === 'opencode' && state.jevRequested && state.discovery.models.some(m => /^opencode-go\\/jev(?:[-.][a-z0-9.-]+)?$/.test(m)) ? 'checked' : 'unchecked' },
  ];
}

/** Activate (Enter) on the instructions menu or an open browser row. */
export function activateInstructions(state: SessionState, id: string, entries: BrowserEntry[]): Action | null {
  if (state.rulesBrowser.open) {
    if (id === '__cancel__') return { type: 'CLOSE_RULES_BROWSER' };
    if (id === '__hidden__') return { type: 'BROWSER_HIDDEN', show: !state.rulesBrowser.showHidden };
    if (id === '..') {
      const parent = dirname(state.rulesBrowser.dir);
      return { type: 'BROWSER_NAV', dir: parent === state.rulesBrowser.dir ? state.rulesBrowser.dir : parent };
    }
    const entry = entries.find((item) => item.id === id);
    if (!entry) return null;
    if (entry.isDirectory) return { type: 'BROWSER_NAV', dir: entry.id };
    return commitBrowserFile(entry.id);
  }
  if (id === 'jev') return { type: 'TOGGLE_JEV' };
  if (id === 'rules-browse') return { type: 'OPEN_RULES_BROWSER' };
  if (id === 'rules-path') return { type: 'SET_DRAFT', for: 'rules-path', value: '' };
  if (id === 'rules-clear') return { type: 'CLEAR_RULES' };
  if (id === '__next__') return { type: 'NAV', to: 'review' };
  if (id === '__back__') return { type: 'NAV', to: 'agents' };
  return null;
}

/** Loader-validated commit of a browser file; failures stay in the browser. */
export function commitBrowserFile(path: string): Action {
  try {
    const rules = loadPersonalRulesFile(path);
    return { type: 'SET_RULES', rules };
  } catch (error) {
    return { type: 'BROWSER_ERROR', error: error instanceof Error ? error.message : 'Cannot load rules file' };
  }
}

/** Commit the direct-path draft (Enter). Throws an actionable message. */
export function commitRulesPath(state: SessionState): Action {
  const raw = state.draft.trim();
  if (!raw) return { type: 'CLEAR_DRAFT' };
  const rules = loadPersonalRulesFile(resolve(state.targetDir, raw));
  return { type: 'SET_RULES', rules };
}

export function instructionsShortcuts(state: SessionState): string[] {
  if (state.rulesBrowser.open) return ['↑↓ navigate', 'Enter open/select', 'Enter on Show hidden toggles dotfiles', 'Esc cancel (keeps prior rules)'];
  if (state.draftFor === 'rules-path') {
    if (state.region === 1) return ['↑↓ choose action', 'Enter activate', 'Tab back to input', 'Esc quit dialog'];
    return ['Type or paste a path', 'Enter load', 'Tab actions (Load/Cancel)', 'Esc quit dialog (draft kept)'];
  }
  return ['↑↓ navigate', 'Enter activate/toggle', 'Esc quit'];
}

export const INSTRUCTIONS_NOTE = 'Personal instructions are stored outside the repository in your user configuration and apply across projects for this harness.';
export const BROWSER_EMPTY = 'Empty folder — navigate elsewhere or cancel; prior rules are kept.';

export function instructionsFixedRows(state: SessionState, width: number, compact: boolean, minimal = false, hintMode: 'all' | 'focused' | 'none' = compact ? 'focused' : 'all', editDetails = false): number {
  if (state.rulesBrowser.open) {
    const { entries, error } = browserEntries(state.rulesBrowser.dir, state.rulesBrowser.showHidden);
    const fsError = state.rulesBrowser.error ?? error;
    const dir = 1;
    // The empty-folder note is advisory; the rows stay navigable without it.
    const empty = !minimal && entries.length <= 1 && !fsError ? wrapLines(BROWSER_EMPTY, width).length : 0;
    if (compact) return dir + empty;
    return 1 + dir + empty + 1;
  }
  // Minimum band hides the advisory rules line; the rows carry the state.
  const rules = minimal ? 0 : 1;
  if (state.draftFor === 'rules-path') {
    const label = wrapLines(instructionsPathLabel(minimal, state.targetDir), width).length;
    const actionCount = state.region === 1 ? (editDetails ? 3 : 2) : 0;
    const actions = actionCount === 0 ? 0 : (compact ? (hintMode === 'none' ? actionCount : actionCount + 1) : 1 + actionCount + 1);
    if (compact) return rules + label + 1 + actions;
    return 1 + wrapLines(INSTRUCTIONS_NOTE, width).length + rules + 1 + label + 1 + actions;
  }
  if (compact) return rules;
  return 1 + wrapLines(INSTRUCTIONS_NOTE, width).length + rules + 1;
}

export function instructionsPathLabel(minimal: boolean, targetDir: string): string {
  if (minimal) return 'Rules file path:';
  return `Path to rules file (relative to ${targetDir}, or absolute; no credentials/secrets):`;
}

export function InstructionsScreen(options: { state: SessionState; width: number; listHeight: number; compact: boolean; hintMode?: 'all' | 'focused' | 'none'; minimal?: boolean; editDetails?: boolean }): React.JSX.Element {
  const { state, width, listHeight, compact, hintMode, minimal = false , editDetails = false } = options;
  const editingPath = state.draftFor === 'rules-path';
  if (state.rulesBrowser.open) {
    const { entries, error } = browserEntries(state.rulesBrowser.dir, state.rulesBrowser.showHidden);
    // Browser diagnostics render once at App level (single error source);
    // the empty-folder note still keys off the same local error state.
    const browserFsError = state.rulesBrowser.error ?? error;
    const items: MenuItem[] = instructionsBrowserItems(entries, state.rulesBrowser.showHidden);
    return (
      <Box flexDirection="column">
        {!compact && <Text color={palette.cream} bold>Select additional rules (.md or .txt)</Text>}
        <Text color={palette.parchment} wrap="truncate">{`Directory: ${state.rulesBrowser.dir}`}</Text>
        {!minimal && entries.length <= 1 && !browserFsError && <Text color={palette.parchment} wrap="wrap">{BROWSER_EMPTY}</Text>}
        <Box marginTop={compact ? 0 : 1}>
          <MenuList items={items} focusedId={state.focusId} viewportHeight={listHeight} width={width} compact={compact} hintMode={hintMode} />
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {!compact && <Text color={palette.cream} bold>Personal instructions</Text>}
      {!compact && (
        <Text color={palette.parchment} wrap="wrap">{INSTRUCTIONS_NOTE}</Text>
      )}
      {!minimal && <Text color={palette.parchment}>{`Current rules: ${state.personalRules.trim() ? 'loaded' : 'none'}`}</Text>}
      {editingPath && (
        <Box marginTop={compact ? 0 : 1} flexDirection="column">
          <Text color={palette.gold} wrap="wrap">{instructionsPathLabel(minimal, state.targetDir)}</Text>
          <TextField value={state.draft} cursor={state.cursor} focused={state.region === 0} width={width} />
          {state.region === 1 && (
            <Box marginTop={compact ? 0 : 1}>
              <EditActions focusedId={state.focusId} width={width} hintMode={hintMode} showDetails={editDetails} />
            </Box>
          )}
        </Box>
      )}
      {!editingPath && (
        <Box marginTop={compact ? 0 : 1}>
          <MenuList items={instructionsItems(state)} focusedId={state.focusId} viewportHeight={listHeight} width={width} compact={compact} hintMode={hintMode} />
        </Box>
      )}
    </Box>
  );
}
