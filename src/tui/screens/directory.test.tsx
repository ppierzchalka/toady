import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialState, reducer, type SessionState } from '../state.js';
import {
  activateDirectory,
  directoryFocusIds,
  directoryItems,
  isUseTarget,
  localTargetRefresh,
  targetEntries,
  validateTargetDir,
} from './directory.js';
import { instructionsShortcuts } from './instructions.js';

function workspace(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 't08-dir-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function stateFor(patch: Record<string, unknown> = {}): SessionState {
  const state = createInitialState({
    targetDir: '/repo',
    harness: 'opencode',
    config: {},
    overwrite: {},
        personalRules: '',
    skillConflicts: [],
    vscodeKept: true,
  });
  state.discovery = { status: 'ready', models: ['opencode/alpha'], detail: '' };
  return { ...state, ...patch } as SessionState;
}

describe('target folder entries', () => {
  it('lists parent then child directories only, hiding dotfiles by default', () => {
    const { root, cleanup } = workspace();
    try {
      mkdirSync(join(root, 'docs'));
      mkdirSync(join(root, '.hidden-dir'));
      writeFileSync(join(root, 'rules.md'), 'x');
      writeFileSync(join(root, 'notes.txt'), 'x');
      const { entries, error } = targetEntries(root, false);
      expect(error).toBeNull();
      expect(entries.map((entry) => entry.label)).toEqual(['.. (parent)', 'docs/']);
      const shown = targetEntries(root, true);
      expect(shown.entries.map((entry) => entry.label)).toContain('.hidden-dir/');
      // Files are never installation targets.
      expect(shown.entries.map((entry) => entry.label)).not.toContain('rules.md');
    } finally {
      cleanup();
    }
  });

  it('skips symlinked directories and reports missing folders as recoverable data', () => {
    const { root, cleanup } = workspace();
    try {
      symlinkSync(root, join(root, 'loop'), 'dir');
      const { entries, error } = targetEntries(root, false);
      expect(error).toBeNull();
      expect(entries.map((entry) => entry.label)).toEqual(['.. (parent)']);
      const missing = targetEntries(join(root, 'nope'), false);
      expect(missing.entries).toEqual([]);
      expect(missing.error).toContain('ENOENT');
    } finally {
      cleanup();
    }
  });
});

describe('target safety validation', () => {
  it('rejects missing paths, files and symlinks without throwing', () => {
    const { root, cleanup } = workspace();
    try {
      expect(validateTargetDir(join(root, 'missing'))).toContain('Cannot use');
      const file = join(root, 'file.md');
      writeFileSync(file, 'x');
      expect(validateTargetDir(file)).toContain('Not a directory');
      const link = join(root, 'link');
      symlinkSync(root, link, 'dir');
      expect(validateTargetDir(link)).toContain('symlink');
      expect(validateTargetDir(root)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('target refresh loader', () => {
  it('loads the new target saved config and editor status, keeping session conflicts', () => {
    const { root, cleanup } = workspace();
    try {
      mkdirSync(join(root, '.opencode'), { recursive: true });
      writeFileSync(join(root, '.opencode', 'team.config.json'), JSON.stringify({ lead: { model: 'other/b-model' } }));
      const refresh = localTargetRefresh(root, 'opencode', ['wayfinder']);
      expect(refresh.config.lead).toEqual({ model: 'other/b-model' });
      expect(refresh.skillConflicts).toEqual(['wayfinder']);
      expect(typeof refresh.vscodeKept).toBe('boolean');
    } finally {
      cleanup();
    }
  });

  it('throws a recoverable message for malformed saved configuration', () => {
    const { root, cleanup } = workspace();
    try {
      mkdirSync(join(root, '.opencode'), { recursive: true });
      writeFileSync(join(root, '.opencode', 'team.config.json'), '{broken');
      expect(() => localTargetRefresh(root, 'opencode', [])).toThrow(/Cannot load saved configuration/);
    } finally {
      cleanup();
    }
  });
});

describe('target browser activation', () => {
  it('opens, navigates and cancels with target and config unchanged', () => {
    let state = stateFor({ config: { lead: { model: 'vertex/gemini' } } });
    state = reducer(state, { type: 'OPEN_TARGET_BROWSER' });
    expect(state.targetBrowser.open).toBe(true);
    expect(state.targetBrowser.dir).toBe('/repo');
    // The browsed-path info row leads: full path inspectable, Enter a noop.
    expect(state.focusId).toBe('info:browsed');
    expect(activateDirectory(state, 'info:browsed', [])).toBeNull();
    state = reducer(state, { type: 'TARGET_NAV', dir: '/other' });
    expect(state.targetBrowser.dir).toBe('/other');
    state = reducer(state, { type: 'CLOSE_TARGET_BROWSER' });
    expect(state.targetBrowser.open).toBe(false);
    expect(state.targetDir).toBe('/repo');
    expect(state.config.lead).toEqual({ model: 'vertex/gemini' });
    expect(state.focusId).toBe('change');
  });

  it('routes the Use-this-folder row through the shell refresh, never a pure action', () => {
    const browsing = stateFor({ targetBrowser: { open: true, dir: '/repo', showHidden: false, focusId: '__use__', scrollTop: 0, error: null } });
    expect(isUseTarget('__use__')).toBe(true);
    expect(isUseTarget('..')).toBe(false);
    expect(isUseTarget('info:browsed')).toBe(false);
    const { entries } = targetEntries('/tmp', false);
    expect(activateDirectory(browsing, '__use__', entries)).toBeNull();
    expect(activateDirectory(browsing, 'info:browsed', entries)).toBeNull();
    expect(activateDirectory(browsing, '__cancel__', entries)).toEqual({ type: 'CLOSE_TARGET_BROWSER' });
    expect(activateDirectory(browsing, '__hidden__', entries)).toEqual({ type: 'TARGET_HIDDEN', show: true });
  });

  it('applies a clean switch atomically and resets the edit baseline', () => {
    let state = stateFor({ personalRules: 'Keep me.', skillConflicts: ['old'], adoptSkills: true });
    state = reducer(state, {
      type: 'SET_TARGET',
      dir: '/b',
      config: { lead: { model: 'other/b-model' } },
      skillConflicts: ['wayfinder'],
      vscodeKept: false,
    });
    expect(state.targetDir).toBe('/b');
    expect(state.config).toEqual({ lead: { model: 'other/b-model' } });
    expect(state.skillConflicts).toEqual(['wayfinder']);
    expect(state.vscodeKept).toBe(false);
    expect(state.adoptSkills).toBe(false);
    expect(state.settingsTouched).toBe(false);
    // Personal settings are user-scoped: untouched by a target switch.
    expect(state.personalRules).toBe('Keep me.');
    expect(state.notice).toContain('/b');
    expect(state.focusId).toBe('confirm');
  });

  it('requires explicit consent when switching would discard user-edited settings', () => {
    let state = stateFor();
    state = reducer(state, { type: 'SET_MODEL', name: 'lead', model: 'custom/mine' });
    expect(state.settingsTouched).toBe(true);
    state = reducer(state, {
      type: 'REQUEST_TARGET',
      dir: '/b',
      config: { lead: { model: 'other/b-model' } },
      skillConflicts: [],
      vscodeKept: true,
    });
    expect(state.targetPending?.dir).toBe('/b');
    expect(state.targetDir).toBe('/repo');
    expect(state.config.lead).toEqual({ model: 'custom/mine' });
    expect(state.focusId).toBe('target-confirm');
    // Consent copy explains the discard; cancel keeps everything.
    const items = directoryItems(state);
    expect(items.map((item) => item.id)).toEqual(['target-confirm', 'target-cancel']);
    let cancelled = reducer(state, { type: 'CANCEL_TARGET' });
    expect(cancelled.targetPending).toBeNull();
    expect(cancelled.targetDir).toBe('/repo');
    expect(cancelled.config.lead).toEqual({ model: 'custom/mine' });
    // Confirming replaces the config with the new target's saved choices.
    cancelled = reducer(state, { type: 'REQUEST_TARGET', dir: '/b', config: { lead: { model: 'other/b-model' } }, skillConflicts: [], vscodeKept: true });
    const applied = reducer(cancelled, { type: 'APPLY_TARGET_PENDING' });
    expect(applied.targetDir).toBe('/b');
    expect(applied.config.lead).toEqual({ model: 'other/b-model' });
    expect(activateDirectory(state, 'target-confirm')).toEqual({ type: 'APPLY_TARGET_PENDING' });
    expect(activateDirectory(state, 'target-cancel')).toEqual({ type: 'CANCEL_TARGET' });
  });

  it('refreshes harness conflicts and editor status while retaining committed models', () => {
    let state = stateFor({ config: { lead: { model: 'vertex/gemini' } }, skillConflicts: ['wayfinder'] });
    state = reducer(state, { type: 'SET_HARNESS', harness: 'codex' });
    state = reducer(state, { type: 'REFRESH_HARNESS', skillConflicts: [], vscodeKept: false });
    expect(state.harness).toBe('codex');
    expect(state.config.lead).toEqual({ model: 'vertex/gemini' });
    expect(state.skillConflicts).toEqual([]);
    expect(state.vscodeKept).toBe(false);
  });

  it('keeps recoverable picker errors local with the committed target intact', () => {
    let state = stateFor();
    state = reducer(state, { type: 'OPEN_TARGET_BROWSER' });
    state = reducer(state, { type: 'TARGET_ERROR', error: 'Cannot use /gone: ENOENT. The committed target is unchanged.' });
    expect(state.targetBrowser.open).toBe(true);
    expect(state.targetBrowser.error).toContain('ENOENT');
    expect(state.targetDir).toBe('/repo');
  });

  it('restores browser, pending consent and navigation exactly through quit-continue', () => {
    let state = stateFor({ step: 'directory', focusId: '__use__' });
    state = reducer(state, { type: 'OPEN_TARGET_BROWSER' });
    state = reducer(state, { type: 'TARGET_NAV', dir: '/b' });
    state = reducer(state, { type: 'SET_MODEL', name: 'lead', model: 'custom/mine' });
    state = reducer(state, { type: 'REQUEST_TARGET', dir: '/b', config: {}, skillConflicts: [], vscodeKept: true });
    state = reducer(state, { type: 'REQUEST_QUIT' });
    expect(state.quitDialog).not.toBeNull();
    state = reducer(state, { type: 'FOCUS', id: 'quit' });
    state = reducer(state, { type: 'QUIT_CONTINUE' });
    expect(state.quitDialog).toBeNull();
    expect(state.targetBrowser.open).toBe(true);
    expect(state.targetBrowser.dir).toBe('/b');
    expect(state.targetPending?.dir).toBe('/b');
    expect(state.focusId).toBe('target-confirm');
    expect(state.targetDir).toBe('/repo');
  });

  it('exposes picker rows in focus order without activating info rows', () => {
    const browsing = stateFor({ targetBrowser: { open: true, dir: '/repo', showHidden: false, focusId: '..', scrollTop: 0, error: null } });
    const sample = [{ id: '..', label: '.. (parent)' }, { id: '/repo/a', label: 'a/' }];
    expect(directoryFocusIds(browsing, sample)).toEqual(['info:browsed', '..', '/repo/a', '__hidden__', '__use__', '__cancel__']);
    expect(directoryItems(browsing, sample)[0]).toMatchObject({ id: 'info:browsed', label: '/repo' });
    expect(directoryFocusIds(stateFor())).toEqual(['change', 'confirm', 'quit']);
    expect(directoryFocusIds(stateFor(), [], true)).toEqual(['info:target', 'change', 'confirm', 'quit']);
    expect(activateDirectory(stateFor(), 'change')).toEqual({ type: 'OPEN_TARGET_BROWSER' });
    expect(activateDirectory(stateFor(), 'confirm')).toEqual({ type: 'NAV', to: 'agents' });
    expect(activateDirectory(stateFor(), 'quit')).toEqual({ type: 'REQUEST_QUIT' });
    expect(activateDirectory(stateFor(), 'info:target')).toBeNull();
  });
});

describe('personal instructions shortcuts', () => {
  it('advertises activation without a voice toggle', () => {
    const shortcuts = instructionsShortcuts(stateFor());
    expect(shortcuts.join(' ')).toContain('Enter activate');
    expect(shortcuts.join(' ')).not.toContain('Toady voice');
    expect(shortcuts.join(' ')).not.toContain('Space');
  });
});
