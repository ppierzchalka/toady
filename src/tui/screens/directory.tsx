import React from 'react';
import { Box, Text } from 'ink';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import type { Action, SessionState } from '../state.js';
import type { MenuItem } from '../components/controls.js';
import { MenuList } from '../components/controls.js';
import { fitCapped, wrapLines } from '../layout.js';
import { palette } from '../theme.js';
import { HARNESS_LAYOUTS, type Harness } from '../../installer/harness.js';
import { migratePlannerConfig } from '../../installer/defaults.js';
import { planVscodeSettings } from '../../installer/vscodeSettings.js';
import { checkInstallPath } from '../../installer/installPaths.js';
import type { TeamConfig } from '../../types.js';

export interface TargetEntry {
  id: string;
  label: string;
}

/** Refresh payload loaded from a newly chosen target (config, conflicts,
 * editor status). Personal settings stay user/harness-scoped by construction:
 * no personal instruction field is carried here. */
export interface TargetRefreshData {
  config: TeamConfig;
  skillConflicts: string[];
  vscodeKept: boolean;
}

export type TargetRefreshLoader = (dir: string, harness: Harness) => TargetRefreshData;

/**
 * Native folder entries for a directory: parent first, then child
 * directories only. Files never appear (this picker chooses an installation
 * target, never a rules file), symlinks are skipped, and read failures are
 * reported as recoverable data. Throws nothing.
 */
export function targetEntries(dir: string, showHidden: boolean): { entries: TargetEntry[]; error: string | null } {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error.message : 'Cannot read directory' };
  }
  const dirs: TargetEntry[] = [];
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
    if (stat.isDirectory()) dirs.push({ id: path, label: `${name}/` });
  }
  return { entries: [{ id: '..', label: '.. (parent)' }, ...dirs], error: null };
}

/**
 * Safety gate for an explicitly chosen target. Returns a human error, or
 * null when the directory is usable. Recoverable: the caller keeps the
 * committed session target and stays in the picker. Writes nothing.
 */
export function validateTargetDir(dir: string): string | null {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    return `Cannot use ${dir}: ${error instanceof Error ? error.message : 'unreadable'}. The committed target is unchanged.`;
  }
  if (stat.isSymbolicLink()) return `Cannot install into a symlinked directory: ${dir}. Choose the real directory instead; the committed target is unchanged.`;
  if (!stat.isDirectory()) return `Not a directory: ${dir}. Choose an existing folder; the committed target is unchanged.`;
  try {
    readdirSync(dir);
  } catch (error) {
    return `Cannot read ${dir}: ${error instanceof Error ? error.message : 'unreadable'}. The committed target is unchanged.`;
  }
  return null;
}

function savedConfigFor(dir: string, harness: Harness): TeamConfig {
  const configPath = join(dir, HARNESS_LAYOUTS[harness].config);
  checkInstallPath(dir, configPath);
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, 'utf8')) as TeamConfig;
}

/**
 * Built-in synchronous refresh: reads the target's saved team configuration
 * (migrated) and editor status without writing anything. Conflicts are kept
 * from the session — pass an injected loader (CLI) for full conflict
 * refresh. Malformed saved state throws an actionable message so the picker
 * can recover instead of switching. Synchronous by design: the refresh
 * applies atomically with the target switch, so no stale async result can
 * land on the wrong target.
 */
export function localTargetRefresh(dir: string, harness: Harness, keepConflicts: string[]): TargetRefreshData {
  let config: TeamConfig;
  try {
    config = migratePlannerConfig(savedConfigFor(dir, harness));
  } catch (error) {
    throw new Error(`Cannot load saved configuration from ${dir}: ${error instanceof Error ? error.message : 'invalid'}. The committed target is unchanged.`);
  }
  let vscodeKept = true;
  try {
    vscodeKept = planVscodeSettings(dir).body === null;
  } catch {
    vscodeKept = false;
  }
  return { config, skillConflicts: keepConflicts, vscodeKept };
}

export function directoryFocusIds(state: SessionState, entries: TargetEntry[] = [], minimal = false): string[] {
  if (state.targetPending) return ['target-confirm', 'target-cancel'];
  if (state.targetBrowser.open) {
    // The browsed absolute path leads: it is focusable inspection-only
    // (Enter never commits) with full-detail paging for long paths.
    return ['info:browsed', ...entries.map((entry) => entry.id), '__hidden__', '__use__', '__cancel__'];
  }
  return minimal ? ['info:target', 'change', 'confirm', 'quit'] : ['change', 'confirm', 'quit'];
}

export function directoryItems(state: SessionState, entries: TargetEntry[] = [], minimal = false): MenuItem[] {
  if (state.targetPending) {
    return [
      // Put the consequence before the unbounded path: at 40x8 the safety
      // explanation must not be buried behind dozens of wrapped path rows.
      { id: 'target-confirm', label: minimal ? 'Discard agent edits and switch' : `Switch to ${state.targetPending.dir}`, hint: `Discard session agent edits; load this folder's saved config/defaults. ${TARGET_SWITCH_NOTE}\n${state.targetPending.dir}` },
      { id: 'target-cancel', label: 'Keep the current target' },
    ];
  }
  if (state.targetBrowser.open) {
    return [
      { id: 'info:browsed', label: state.targetBrowser.dir, hint: 'browsed folder — inspection only; Enter does nothing' },
      ...entries.map((entry) => ({ id: entry.id, label: entry.label })),
      { id: '__hidden__', label: state.targetBrowser.showHidden ? 'Hide hidden entries' : 'Show hidden entries' },
      { id: '__use__', label: 'Use this folder', hint: 'install into the browsed directory' },
      { id: '__cancel__', label: 'Cancel (keep prior target)' },
    ];
  }
  if (minimal) {
    // Minimum band: the full path scrolls as an info row; actions stay short.
    return [
      { id: 'info:target', label: absoluteTarget(state.targetDir) },
      { id: 'change', label: 'Choose another target folder', hint: 'browse; navigating never writes' },
      { id: 'confirm', label: 'Install into this directory', hint: 'Nothing is written until Review → Install' },
      { id: 'quit', label: 'Quit without writing', hint: 'Exit setup; no files change' },
    ];
  }
  return [
    { id: 'change', label: 'Choose another target folder', hint: 'browse existing folders; navigating never writes' },
    { id: 'confirm', label: `Install into ${state.targetDir}`, hint: 'Nothing is written until Review → Install' },
    { id: 'quit', label: 'Quit without writing', hint: 'Exit setup; no files change' },
  ];
}

export const DIRECTORY_NOTE = 'Team files land only in the confirmed target folder. Personal instructions stay in your user configuration. Running from a package cache adds nothing anywhere until you confirm Install.';
export const TARGET_EMPTY = 'Empty folder — navigate elsewhere, use this folder, or cancel; the committed target is unchanged.';
export const TARGET_SWITCH_NOTE = 'Switching replaces this session\u2019s agent settings with that folder\u2019s saved configuration. Personal Toady/rules settings are user-scoped and unchanged. Nothing is written until Review → Install.';

export function absoluteTarget(targetDir: string): string {
  return isAbsolute(targetDir) ? targetDir : resolve(targetDir);
}

/** Non-scrollable rows (everything except the menu list). */
export function directoryFixedRows(state: SessionState, width: number, compact: boolean, minimal = false, pathRows = Infinity): number {
  if (state.targetPending) {
    if (minimal) return 0;
    const note = wrapLines(TARGET_SWITCH_NOTE, width).length;
    if (compact) return note + 1;
    return 1 + note + 1 + 1;
  }
  if (state.targetBrowser.open) {
    const { entries, error } = targetEntries(state.targetBrowser.dir, state.targetBrowser.showHidden);
    const fsError = state.targetBrowser.error ?? error;
    const dir = 1;
    const empty = !minimal && entries.length <= 1 && !fsError ? wrapLines(TARGET_EMPTY, width).length : 0;
    if (compact) return dir + empty;
    return 1 + dir + empty + 1;
  }
  if (minimal) return 0;
  const targetLines = Math.min(pathRows, wrapLines(absoluteTarget(state.targetDir), width).length);
  if (compact) return targetLines;
  // Title + one margined block (label, path, note) + menu margin.
  return 1 + 1 + 1 + targetLines + wrapLines(DIRECTORY_NOTE, width).length + 1;
}

/** True for the explicit Use-this-folder row, which the shell resolves with a
 * target refresh (validation + saved config load) instead of a pure action. */
export function isUseTarget(id: string): boolean {
  return id === '__use__';
}

export function activateDirectory(state: SessionState, id: string, entries: TargetEntry[] = []): Action | null {
  if (state.targetPending) {
    if (id === 'target-confirm') return { type: 'APPLY_TARGET_PENDING' };
    if (id === 'target-cancel') return { type: 'CANCEL_TARGET' };
    return null;
  }
  if (state.targetBrowser.open) {
    if (id === '__cancel__') return { type: 'CLOSE_TARGET_BROWSER' };
    if (id === '__hidden__') return { type: 'TARGET_HIDDEN', show: !state.targetBrowser.showHidden };
    // The Use-this-folder row is resolved by the shell (validation + refresh).
    if (isUseTarget(id)) return null;
    // The browsed-path info row is inspection-only: Enter never navigates,
    // commits, or changes the target. Space opens full details instead.
    if (id === 'info:browsed') return null;
    if (id === '..') {
      const parent = dirname(state.targetBrowser.dir);
      return { type: 'TARGET_NAV', dir: parent === state.targetBrowser.dir ? state.targetBrowser.dir : parent };
    }
    const entry = entries.find((item) => item.id === id);
    if (!entry) return null;
    return { type: 'TARGET_NAV', dir: entry.id };
  }
  if (id === 'change') return { type: 'OPEN_TARGET_BROWSER' };
  if (id === 'confirm') return { type: 'NAV', to: 'agents' };
  if (id === 'quit') return { type: 'REQUEST_QUIT' };
  // Info rows scroll but never activate.
  return null;
}

export function DirectoryScreen(options: { state: SessionState; width: number; listHeight: number; compact: boolean; hintMode?: 'all' | 'focused' | 'none'; minimal?: boolean; pathRows?: number }): React.JSX.Element {
  const { state, width, listHeight, compact, hintMode, minimal = false } = options;
  if (state.targetPending) {
    return (
      <Box flexDirection="column">
        {!compact && <Text color={palette.cream} bold>Switch installation target?</Text>}
        {!minimal && <Text color={palette.parchment} wrap="wrap">{TARGET_SWITCH_NOTE}</Text>}
        {!minimal && <Text color={palette.cream} wrap="truncate">{state.targetPending.dir}</Text>}
        <Box marginTop={compact ? 0 : 1}>
          <MenuList items={directoryItems(state, [], minimal)} focusedId={state.focusId} viewportHeight={listHeight} width={width} compact={compact} hintMode={hintMode} />
        </Box>
      </Box>
    );
  }
  if (state.targetBrowser.open) {
    const { entries, error } = targetEntries(state.targetBrowser.dir, state.targetBrowser.showHidden);
    // Browser diagnostics render once at App level (single error source);
    // the empty-folder note still keys off the same local error state.
    const browserFsError = state.targetBrowser.error ?? error;
    const items: MenuItem[] = directoryItems(state, entries, minimal);
    return (
      <Box flexDirection="column">
        {!compact && <Text color={palette.cream} bold>Choose the installation target</Text>}
        <Text color={palette.parchment} wrap="truncate">{`Directory: ${state.targetBrowser.dir}`}</Text>
        {!minimal && entries.length <= 1 && !browserFsError && <Text color={palette.parchment} wrap="wrap">{TARGET_EMPTY}</Text>}
        <Box marginTop={compact ? 0 : 1}>
          <MenuList items={items} focusedId={state.focusId} viewportHeight={listHeight} width={width} compact={compact} hintMode={hintMode} />
        </Box>
      </Box>
    );
  }
  const absolute = absoluteTarget(state.targetDir);
  return (
    <Box flexDirection="column">
      {!compact && <Text color={palette.cream} bold>Installation directory</Text>}
      {!minimal && (
        <Box marginTop={compact ? 0 : 1} flexDirection="column">
          {!compact && <Text color={palette.parchment}>Target (defaults to the invocation directory):</Text>}
           {/* Full path remains on the focusable confirmation's Space details. */}
           <Text color={palette.cream}>{fitCapped(wrapLines(absolute, width), options.pathRows ?? Infinity, width).join('\n')}</Text>
          {!compact && <Text color={palette.parchment} wrap="wrap">{DIRECTORY_NOTE}</Text>}
        </Box>
      )}
      <Box marginTop={compact ? 0 : 1}>
        <MenuList items={directoryItems(state, [], minimal)} focusedId={state.focusId} viewportHeight={listHeight} width={width} compact={compact} hintMode={hintMode} />
      </Box>
    </Box>
  );
}

export function directoryShortcuts(state?: SessionState): string[] {
  if (state?.targetPending) return ['↑↓ choose', 'Enter confirm switch', 'Esc quit dialog'];
  if (state?.targetBrowser.open) return ['↑↓ navigate', 'Enter open / Use this folder', 'Enter on Show hidden toggles dotfiles', 'Esc quit dialog'];
  return ['↑↓ navigate', 'Enter activate', 'Esc quit'];
}
