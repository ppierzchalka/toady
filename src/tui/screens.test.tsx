import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { createInitialState, reducer, type SessionState } from './state.js';
import {
  activateAgentsList,
  activateEditor,
  agentsListFocusIds,
  commitEditorDraft,
  commitSearch,
  editorFocusIds,
  editorItems,
  effortOptions,
  modelOptions,
} from './screens/agents.js';
import { activateInstructions, browserEntries, commitBrowserFile, commitRulesPath } from './screens/instructions.js';
import { activateReview } from './screens/review.js';
import { editText, itemRows, menuGeometry, moveFocus, windowByLines } from './components/controls.js';
import { headerTitle, palette, FOCUS_MARKER, COMMITTED_MARKER } from './theme.js';
import { interactiveBlockers } from './run.js';

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
  state.discovery = { status: 'ready', models: ['opencode/alpha', 'other/beta'], detail: '' };
  return { ...state, ...patch } as SessionState;
}

describe('agent editor options', () => {
  it.each([1, 2, 3])('keeps a middle focused action and its details within a %i-row menu', (budget) => {
    const items = [
      { id: 'before', label: 'Before' },
      { id: 'focus', label: `Install into /${'long-path/'.repeat(20)}` },
      { id: 'after', label: 'After' },
    ];
    const geometry = menuGeometry(items, 'focus', 40, true, 'none', budget);
    expect(geometry.top).toBe(1);
    expect(geometry.bottom).toBe(2);
    expect(geometry.focusCap + Number(geometry.showAbove) + Number(geometry.showBelow)).toBeLessThanOrEqual(budget);
    expect(geometry.focusCap).toBeGreaterThanOrEqual(1);
    expect(geometry.capped).toBe(true);
    expect(moveFocus(items.map((item) => item.id), 'focus', { upArrow: true })).toBe('before');
    expect(moveFocus(items.map((item) => item.id), 'focus', { downArrow: true })).toBe('after');
  });
  it('offers Antigravity tiers instead of provider IDs', () => {
    const options = modelOptions(stateFor({ harness: 'antigravity' }));
    expect(options.map((option) => option.id)).toEqual(['inherit', 'flash', 'pro']);
  });

  it('shows inherit, catalog matches and a custom entry with unmatched search', () => {
    const state = stateFor({ discovery: { status: 'ready', models: ['opencode/alpha', 'other/beta'], detail: '' }, search: 'alp' });
    const ids = modelOptions(state).map((option) => option.id);
    expect(ids[0]).toBe('__inherit__');
    expect(ids).toContain('opencode/alpha');
    expect(ids).not.toContain('other/beta');
    expect(ids).toContain('custom:alp');
    expect(ids[ids.length - 1]).toBe('__custom__');
  });

  it('supports empty catalogs with inherit and custom IDs', () => {
    const state = stateFor({ discovery: { status: 'ready', models: [], detail: '' } });
    expect(modelOptions(state).map((option) => option.id)).toEqual(['__inherit__', '__custom__']);
  });

  it('waits for discovery instead of fabricating models', () => {
    const loading = stateFor({ discovery: { status: 'loading', models: [], detail: '' } });
    expect(modelOptions(loading).map((option) => option.id)).toEqual(['__loading__']);
    expect(activateEditor(loading, 'lead', 'value:__loading__')).toBeNull();
  });

  it('lists effort levels with an explicit unset', () => {
    const state = stateFor({ config: { lead: { model: 'openai/gpt-6-luna' } } });
    const ids = effortOptions(state, 'lead').map((option) => option.id);
    expect(ids[0]).toBe('__unset__');
    expect(ids).toContain('xhigh');
  });

  it('edits native model IDs as free text outside opencode/antigravity', () => {
    const state = stateFor({ harness: 'codex' });
    expect(editorFocusIds(state, 'lead')).toContain('model-text');
    expect(activateEditor(state, 'lead', 'model-text')).toMatchObject({ type: 'SET_DRAFT', for: 'model-id' });
  });

  it('edits Antigravity tools as a comma-separated draft', () => {
    const state = stateFor({ harness: 'antigravity', config: { lead: { additionalTools: ['a'] } } });
    const toTools = activateEditor(state, 'lead', 'field:tools');
    expect(toTools).toMatchObject({ type: 'SET_EDITOR_FIELD', field: 'tools' });
    expect(editorFocusIds({ ...state, editorField: 'tools' }, 'lead')).toContain('tools-text');
    expect(activateEditor({ ...state, editorField: 'tools' }, 'lead', 'tools-text')).toMatchObject({ type: 'SET_DRAFT', for: 'tools', value: 'a' });
    expect(commitEditorDraft({ ...state, draftFor: 'tools', draft: ' a, b ,,a ' }, 'lead')).toEqual({ type: 'SET_TOOLS', name: 'lead', tools: ['a', 'b'] });
  });

  it('commits blank custom IDs as inherit and keeps other roles untouched', () => {
    const action = commitEditorDraft(stateFor({ draftFor: 'model-custom', draft: '  ' }), 'lead');
    expect(action).toEqual({ type: 'SET_MODEL', name: 'lead', model: undefined });
  });

  it('commits the advertised search match or custom ID, never stale focus', () => {
    const catalog = stateFor({ search: 'zzz-brain' });
    expect(commitSearch(catalog, 'lead')).toEqual({ type: 'SET_MODEL', name: 'lead', model: 'zzz-brain' });
    const matched = stateFor({ search: 'Other/BETA' });
    expect(commitSearch(matched, 'lead')).toEqual({ type: 'SET_MODEL', name: 'lead', model: 'other/beta' });
    // Empty query commits nothing (region returns to the list instead).
    expect(commitSearch(stateFor({ search: '   ' }), 'lead')).toEqual({ type: 'SET_REGION', region: 0 });
  });

  it('keeps the eight-role list with harness choice and reset/next rows', () => {
    const ids = agentsListFocusIds();
    expect(ids.slice(0, 5)).toEqual(['opencode', 'claude-code', 'codex', 'antigravity', 'copilot']);
    expect(ids.slice(5, 13)).toEqual(['analyst', 'lead', 'architect', 'security', 'ux', 'tester', 'developer', 'reviewer']);
    expect(ids.slice(13)).toEqual(['__reset_all__', '__back__', '__next__']);
    expect(activateAgentsList(stateFor(), 'codex')).toEqual({ type: 'SET_HARNESS', harness: 'codex' });
    expect(activateAgentsList(stateFor(), '__back__')).toEqual({ type: 'NAV', to: 'directory' });
    expect(activateAgentsList(stateFor(), 'lead')).toEqual({ type: 'OPEN_AGENT', name: 'lead' });
  });

  it('marks committed selections distinctly from focus', () => {
    const items = editorItems(stateFor({ config: { lead: { model: 'opencode/alpha' } }, discovery: { status: 'ready', models: ['opencode/alpha'], detail: '' } }), 'lead');
    const committed = items.find((item) => item.id === 'value:opencode/alpha');
    expect(committed?.state).toBe('committed');
    expect(FOCUS_MARKER).toBe('>');
    expect(COMMITTED_MARKER).toBe('•');
  });
});

describe('native rules browser', () => {
  it('lists parent, directories then eligible files while hiding dotfiles', () => {
    const root = mkdtempSync(join(tmpdir(), 'browser-'));
    try {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'rules.md'), 'x');
      writeFileSync(join(root, 'notes.txt'), 'x');
      writeFileSync(join(root, 'secret.env'), 'x');
      writeFileSync(join(root, '.hidden.md'), 'x');
      const { entries, error } = browserEntries(root, false);
      expect(error).toBeNull();
      expect(entries[0]).toMatchObject({ id: '..' });
      expect(entries.map((entry) => entry.label)).toEqual(['.. (parent)', 'docs/', 'notes.txt', 'rules.md']);
      const shown = browserEntries(root, true);
      expect(shown.entries.map((entry) => entry.label)).toContain('.hidden.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips symlinks and reports unreadable folders as recoverable errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'browser-link-'));
    try {
      symlinkSync(root, join(root, 'loop'), 'dir');
      const { entries, error } = browserEntries(root, false);
      expect(error).toBeNull();
      expect(entries.map((entry) => entry.label)).toEqual(['.. (parent)']);
      expect(browserEntries(join(root, 'missing'), false).error).toContain('ENOENT');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('commits only loader-validated content and keeps failures local', () => {
    const root = mkdtempSync(join(tmpdir(), 'browser-load-'));
    try {
      const valid = join(root, 'ok.md');
      const invalid = join(root, 'bad.md');
      writeFileSync(valid, 'Good rules.');
      writeFileSync(invalid, '<!-- spec-driven-scrum-team:toady:end -->');
      expect(commitBrowserFile(valid)).toEqual({ type: 'SET_RULES', rules: 'Good rules.' });
      expect(commitBrowserFile(invalid)).toMatchObject({ type: 'BROWSER_ERROR' });
      expect(commitBrowserFile(join(root, 'missing.md'))).toMatchObject({ type: 'BROWSER_ERROR' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recovers from oversized files without losing prior rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'browser-huge-'));
    try {
      const huge = join(root, 'huge.md');
      writeFileSync(huge, 'x'.repeat(65537));
      const failure = commitBrowserFile(huge);
      expect(failure).toMatchObject({ type: 'BROWSER_ERROR' });
      // A browser error never commits: the session keeps prior rules and the
      // browser stays open for another choice.
      const browsing = stateFor({
        personalRules: 'Keep me.',
        rulesBrowser: { open: true, dir: root, showHidden: false, focusId: huge, scrollTop: 0, error: null },
      });
      const next = reducer(browsing, failure);
      expect(next.personalRules).toBe('Keep me.');
      expect(next.rulesBrowser.open).toBe(true);
      expect(next.rulesBrowser.error).toContain('64 KiB');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('validates direct paths against the installation directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'browser-path-'));
    try {
      writeFileSync(join(root, 'r.md'), 'Path rules.');
      const state = stateFor({ targetDir: root, draft: 'r.md', draftFor: 'rules-path' });
      expect(commitRulesPath(state)).toEqual({ type: 'SET_RULES', rules: 'Path rules.' });
      expect(commitRulesPath(stateFor({ draft: '  ', draftFor: 'rules-path' }))).toEqual({ type: 'CLEAR_DRAFT' });
      expect(() => commitRulesPath(stateFor({ targetDir: root, draft: 'nope.md', draftFor: 'rules-path' }))).toThrow();
      const browsing = stateFor({ rulesBrowser: { open: true, dir: root, showHidden: false, focusId: '..', scrollTop: 0, error: null } });
      expect(activateInstructions(browsing, '__cancel__', [])).toEqual({ type: 'CLOSE_RULES_BROWSER' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('review activation', () => {
  it('blocks installation on unadopted conflicts and explains adoption', () => {
    const blocked = activateReview(stateFor({ skillConflicts: ['wayfinder'] }), 'install');
    expect(blocked).toMatchObject({ type: 'ERROR' });
    const adopted = activateReview(stateFor({ skillConflicts: ['wayfinder'], adoptSkills: true }), 'install');
    expect(adopted).toBe('install');
    expect(activateReview(stateFor(), 'install')).toBe('install');
    expect(activateReview(stateFor(), 'back')).toEqual({ type: 'NAV', to: 'instructions' });
    expect(activateReview(stateFor({ skillConflicts: ['a'] }), 'adopt')).toEqual({ type: 'SET_ADOPT_SKILLS', adopt: true });
  });
});

describe('menu rows and windowing', () => {
  it('shows the full focused value while truncating the rest', () => {
    const long = { id: 'm', label: 'opencode/alpha-model-with-a-quite-long-identifier-0123456789' };
    const focused = itemRows(long, true, 40, false, 'all');
    const flat = focused.join('').replace(/ {2,}/g, '');
    expect(flat).toContain('opencode/alpha-model-with-a-quite-long-identifier-0123456789');
    expect(itemRows(long, false, 40, false)).toEqual([expect.stringContaining('…')]);
    const hinted = itemRows({ id: 'h', label: 'short', hint: 'a much longer hint that must wrap fully when focused' }, true, 30, true, 'all');
    const hintText = hinted.join('');
    expect(hintText).toContain('a much longer hint that');
    expect(hintText).toContain('must wrap fully when');
    expect(hintText).toContain('focused');
    expect(itemRows({ id: 'h', label: 'short', hint: 'hidden' }, true, 30, true, 'none')).toEqual(['>   short']);
  });

  it('windows by lines keeping the focus visible inside the budget', () => {
    const counts = [1, 2, 1, 3, 1];
    const window = windowByLines(counts, 3, 5);
    expect(window.top).toBeLessThanOrEqual(3);
    expect(window.bottom).toBeGreaterThan(3);
    let used = 0;
    for (let i = window.top; i < window.bottom; i += 1) used += counts[i] ?? 0;
    // Focused item (3 lines) plus neighbors fit the 5-line budget.
    expect(used).toBeLessThanOrEqual(5);
    expect(windowByLines([1, 1, 1], 5, 3)).toEqual({ top: 0, bottom: 3 });
  });
});

describe('keyboard controls', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moves with arrows, jumps with Home/End and pages long lists', () => {
    expect(moveFocus(ids, 'b', { upArrow: true })).toBe('a');
    expect(moveFocus(ids, 'a', { upArrow: true })).toBe('a');
    expect(moveFocus(ids, 'c', { downArrow: true })).toBe('d');
    expect(moveFocus(ids, 'c', { home: true })).toBe('a');
    expect(moveFocus(ids, 'a', { end: true })).toBe('d');
    const long = Array.from({ length: 30 }, (_, i) => `i${i}`);
    expect(moveFocus(long, 'i5', { pageDown: true })).toBe('i15');
    expect(moveFocus(long, 'i25', { pageUp: true })).toBe('i15');
    expect(moveFocus([], 'x', { downArrow: true })).toBe('x');
  });

  it('edits text with cursor, backspace and pastes; Escape cancels', () => {
    expect(editText({ value: 'abc', cursor: 1 }, 'X', {})).toEqual({ edit: { value: 'aXbc', cursor: 2 }, cancelled: false });
    expect(editText({ value: 'abc', cursor: 3 }, '', { backspace: true })).toEqual({ edit: { value: 'ab', cursor: 2 }, cancelled: false });
    expect(editText({ value: 'a', cursor: 1 }, 'pasted/path.md', {})).toEqual({ edit: { value: 'apasted/path.md', cursor: 15 }, cancelled: false });
    expect(editText({ value: 'a c', cursor: 1 }, ' ', {})).toEqual({ edit: { value: 'a  c', cursor: 2 }, cancelled: false });
    expect(editText({ value: 'ab', cursor: 2 }, '', { escape: true }).cancelled).toBe(true);
    expect(editText({ value: 'ab', cursor: 0 }, '', { rightArrow: true })).toEqual({ edit: { value: 'ab', cursor: 1 }, cancelled: false });
    expect(editText({ value: 'ab', cursor: 2 }, '', { home: true })).toEqual({ edit: { value: 'ab', cursor: 0 }, cancelled: false });
  });
});

describe('chrome and startup guards', () => {
  it('shares product/step headers and palette tokens', () => {
    expect(headerTitle('agents')).toContain('Step 2 of 4');
    expect(palette.cream).toBe('#F5ECD8');
    expect(palette.gold).toBe('#D9A441');
  });

  it('refuses interactive startup without a real terminal', () => {
    expect(interactiveBlockers({ stdinTTY: true, stdoutTTY: true, term: 'xterm', rawMode: true })).toBeNull();
    expect(interactiveBlockers({ stdinTTY: true, stdoutTTY: true, term: 'dumb', rawMode: true })).toContain('TERM=dumb');
    expect(interactiveBlockers({ stdinTTY: false, stdoutTTY: true, term: 'xterm', rawMode: true })).toContain('not a TTY');
    expect(interactiveBlockers({ stdinTTY: true, stdoutTTY: true, term: 'xterm', rawMode: false })).toContain('Raw mode');
  });

  it('keeps installer and CLI engines free of Ink/React', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) sources.push(path);
      }
    };
    walk(join(root, 'src/installer'));
    walk(join(root, 'src/cli'));
    expect(sources.length).toBeGreaterThan(5);
    for (const path of sources) {
      const body = readFileSync(path, 'utf8');
      expect(body, path).not.toMatch(/from ['"](ink|react)['"]/);
      expect(body, path).not.toContain("from 'ink");
    }
  });
});
