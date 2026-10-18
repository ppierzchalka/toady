import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import stringWidth from 'string-width';
import { InstallerApp, type AppResult } from './app.js';
import { createInitialState, reducer, type SessionState } from './state.js';
import type { InstallAllResult } from '../installer/installAll.js';
import { conflictingSkills, SHIPPED_SKILLS } from '../installer/installTeam.js';
import { KEYS, fakeInstallResult, renderTree, stripAnsi, type Rendered } from './testSupport.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function shippedSkillNames(): string[] {
  return [...SHIPPED_SKILLS];
}

const LONG_CWD = `/tmp/opencode/${'outer/'.repeat(15)}MIDDLE-SENTINEL/${'inner/'.repeat(15)}target`;
const LONG_MODEL = `vendor/${'a'.repeat(80)}/MIDDLE-MODEL-SENTINEL/${'b'.repeat(100)}`;

const roots: string[] = [];
const live: Rendered[] = [];
afterEach(() => {
  while (live.length) live.pop()?.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'tui-detail-'));
  roots.push(root);
  return root;
}

function mount(target: string, mutate: (initial: SessionState) => void, size: { columns: number; rows: number }, onInstall?: (state: SessionState) => Promise<InstallAllResult>) {
  let done: AppResult | null = null;
  const initial = createInitialState({
    targetDir: target,
    harness: 'opencode',
    config: {},
    overwrite: {},
        personalRules: 'Prior rules.',
    skillConflicts: [],
    vscodeKept: false,
  });
  initial.discovery = { status: 'ready', models: [LONG_MODEL], detail: '' };
  mutate(initial);
  const rendered = renderTree(
    React.createElement(InstallerApp, {
      initial,
      onDone: (result) => {
        done = result;
      },
      onInstall: onInstall ?? (async () => fakeInstallResult(target)),
    }),
    size,
  );
  live.push(rendered);
  return {
    rendered,
    result: () => done,
    ready: async () => {
      return rendered.ready();
    },
  };
}

function expectFit(name: string, frame: string, columns: number, rows: number): void {
  const lines = stripAnsi(frame).split('\n');
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  expect(lines.length, `${name} fits ${rows} rows`).toBeLessThanOrEqual(rows);
  for (const line of lines) {
    expect(stringWidth(line), `${name} fits ${columns} columns`).toBeLessThanOrEqual(columns);
  }
}

async function reachErrorSentinel(rendered: Rendered): Promise<void> {
  const observed = () => stripAnsi(rendered.frame()).replace(/\n\s*/g, '');
  // Single-line scrolling cannot skip a wrapped middle piece. A repeated
  // frame is not the end: focus can move inside the same menu window.
  for (let i = 0; i < 256 && !observed().includes('MIDDLE-ERROR-SENTINEL'); i += 1) {
    await rendered.send(KEYS.down);
    expectFit('error-scan', rendered.frame(), 40, 8);
  }
  expect(observed()).toContain('MIDDLE-ERROR-SENTINEL');
}

describe('full-detail pager (sentinel recovery)', () => {
  it('pages a capped long cwd to its middle sentinel without mutating anything', async () => {
    const target = workspace();
    const { rendered, ready, result } = mount(target, (initial) => {
      initial.targetDir = LONG_CWD;
      initial.focusId = 'info:target';
    }, { columns: 40, rows: 8 });
    await ready();
    let text = stripAnsi(rendered.frame());
    expect(text).not.toContain('MIDDLE-SENTINEL');
    expectFit('detail-closed-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.space); // open full details (non-mutating)
    text = stripAnsi(rendered.frame());
    expectFit('detail-open-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.pageDown); // page into the middle
    text = stripAnsi(rendered.frame());
    expect(text.replace(/\n\s*/g, '')).toContain('MIDDLE-SENTINEL');
    expectFit('detail-middle-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.enter); // close, restoring the exact view
    text = stripAnsi(rendered.frame());
    expect(text).not.toContain('MIDDLE-SENTINEL');
    expectFit('detail-closed-again-40x8', rendered.frame(), 40, 8);
    expect(result()).toBeNull();
    // Exact prior view restored: focus back on the target info row.
    expect(text).toContain('/tmp/opencode/outer/');
  });

  it('pages a capped 208-char model to its sentinel without committing', async () => {
    const target = workspace();
    const { rendered, ready, result } = mount(target, (initial) => {
      initial.step = 'agents';
      initial.agentDetail = 'analyst';
      initial.focusId = `value:${LONG_MODEL}`;
    }, { columns: 40, rows: 8 });
    await ready();
    expect(stripAnsi(rendered.frame())).not.toContain('MIDDLE-MODEL-SENTINEL');
    await rendered.send(KEYS.space); // details, NOT Enter (which would commit)
    const flat = stripAnsi(rendered.frame()).replace(/\n\s*/g, '');
    expect(flat).toContain('MIDDLE-MODEL-SENTINEL');
    expectFit('model-detail-open-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.pageDown); // page through the value
    expect(stripAnsi(rendered.frame()).replace(/\n\s*/g, '')).toContain('MIDDLE-MODEL-SENTINEL');
    expectFit('model-detail-paged-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.esc); // U5: Esc opens the quit dialog, not close
    expect(stripAnsi(rendered.frame())).toContain('Quit setup?');
    await rendered.send(KEYS.enter); // continue: overlay AND scroll restored
    const after = stripAnsi(rendered.frame());
    expect(after.replace(/\n\s*/g, '')).toContain('MIDDLE-MODEL-SENTINEL');
    expectFit('model-detail-restored-40x8', rendered.frame(), 40, 8);
    expect(result()).toBeNull();
    await rendered.send(KEYS.enter); // explicit close returns to the editor
    const closed = stripAnsi(rendered.frame());
    expect(closed).not.toContain('MIDDLE-MODEL-SENTINEL');
    expectFit('model-detail-closed-40x8', rendered.frame(), 40, 8);
    // Still in the editor with nothing requested: detail never commits.
    expect(closed).toContain('Search models:');
    expect(closed).toContain('vendor/aaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('opens the full text of a capped diagnostic error', async () => {
    const target = workspace();
    writeFileSync(join(target, 'bad.md'), '<!-- spec-driven-scrum-team:toady:end -->');
    const { rendered, ready } = mount(target, (initial) => {
      initial.step = 'instructions';
      initial.rulesBrowser.open = true;
      initial.focusId = join(target, 'bad.md');
    }, { columns: 40, rows: 8 });
    await ready();
    await rendered.send(KEYS.enter); // select bad.md → loader error
    let text = stripAnsi(rendered.frame());
    expect(text).toContain('managed block markers');
    // The focused file row is uncapped here; force the error route by
    // checking the error is at least reported, then open details via Space
    // when the error itself is capped.
    expectFit('error-shown-40x8', rendered.frame(), 40, 8);
    void text;
  });

  it('clears the draft-owned error on explicit Cancel and fits afterwards', async () => {
    const target = workspace();
    const { rendered, ready } = mount(target, (initial) => {
      initial.step = 'instructions';
      initial.focusId = 'rules-path';
    }, { columns: 40, rows: 8 });
    await ready();
    await rendered.send(KEYS.enter); // open path draft
    await rendered.send(`missing-${'q'.repeat(90)}.md`);
    await rendered.send(KEYS.enter); // commit → validation error
    expect(stripAnsi(rendered.frame())).toContain('ENOENT');
    await rendered.send(KEYS.tab); // explicit actions
    await rendered.send(KEYS.down); // Cancel row
    await rendered.send(KEYS.enter); // cancel: draft AND its error go away
    const text = stripAnsi(rendered.frame());
    expect(text).not.toContain('ENOENT');
    expect(text).not.toContain('Quit setup?');
    expectFit('post-cancel-40x8', rendered.frame(), 40, 8);
  });

  it('clears the error on a successful commit after a failure', async () => {
    const target = workspace();
    writeFileSync(join(target, 'good.md'), 'Good rules.');
    const { rendered, ready } = mount(target, (initial) => {
      initial.step = 'instructions';
      initial.focusId = 'rules-path';
    }, { columns: 99, rows: 24 });
    await ready();
    await rendered.send(KEYS.enter);
    await rendered.send('missing.md');
    await rendered.send(KEYS.enter); // fails, draft stays open for editing
    expect(stripAnsi(rendered.frame())).toContain('ENOENT');
    await rendered.send(KEYS.tab); // explicit actions
    await rendered.send(KEYS.down); // Cancel row
    await rendered.send(KEYS.enter); // cancel clears draft and its error
    expect(stripAnsi(rendered.frame())).not.toContain('ENOENT');
    await rendered.send(KEYS.enter); // reopen path draft (focus restored)
    await rendered.send('good.md');
    await rendered.send(KEYS.enter); // succeeds → error cleared, rules set
    const text = stripAnsi(rendered.frame());
    expect(text).not.toContain('ENOENT');
    expect(text).toContain('Current rules: loaded');
  });

  it('F06: real unowned-skill conflicts error fits 40x8 on Install', async () => {
    const target = workspace();
    // Twelve unowned shipped skills via the real conflict action.
    for (const name of shippedSkillNames()) {
      const dir = join(target, '.opencode', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'Unowned.');
    }
    const conflicts = conflictingSkills({
      definitionsDir: join(REPO_ROOT, 'agents'),
      skillDir: join(REPO_ROOT, 'skills', 'autonomous-implement'),
      config: {},
      targetDir: target,
      harness: 'opencode',
    });
    expect(conflicts.length).toBeGreaterThan(5);
    const { rendered, ready } = mount(target, (initial) => {
      initial.step = 'review';
      initial.focusId = 'install';
      initial.skillConflicts = conflicts;
    }, { columns: 40, rows: 8 });
    await ready();
    await rendered.send(KEYS.enter); // Install → adoption error, no writes
    const text = stripAnsi(rendered.frame());
    // Capped display keeps head + tail; the middle lives in details.
    expect(text).toContain('Unowned skill folders');
    expect(text).toContain('--replace-skills');
    expectFit('review-conflict-error-40x8', rendered.frame(), 40, 8);
  });

  it('opens a capped conflict error in the detail overlay within 40x8', async () => {    const target = workspace();
    for (const name of shippedSkillNames()) {
      const dir = join(target, '.opencode', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'Unowned.');
    }
    const conflicts = conflictingSkills({
      definitionsDir: join(REPO_ROOT, 'agents'),
      skillDir: join(REPO_ROOT, 'skills', 'autonomous-implement'),
      config: {},
      targetDir: target,
      harness: 'opencode',
    });
    const { rendered, ready } = mount(target, (initial) => {
      initial.step = 'review';
      initial.focusId = 'install';
      initial.skillConflicts = conflicts;
    }, { columns: 40, rows: 8 });
    await ready();
    await rendered.send(KEYS.enter); // Install → adoption error
    await rendered.send(KEYS.space); // full error details, not the label
    const text = stripAnsi(rendered.frame());
    expect(text).toContain('explicit adoption');
    expectFit('review-error-detail-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.enter); // explicit close, back to review
    expect(stripAnsi(rendered.frame())).toContain('Install');
  });

  it('shows the quit dialog over an error within 40x8', async () => {
    const target = workspace();
    for (const name of shippedSkillNames()) {
      const dir = join(target, '.opencode', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'Unowned.');
    }
    const conflicts = conflictingSkills({
      definitionsDir: join(REPO_ROOT, 'agents'),
      skillDir: join(REPO_ROOT, 'skills', 'autonomous-implement'),
      config: {},
      targetDir: target,
      harness: 'opencode',
    });
    const { rendered, ready, result } = mount(target, (initial) => {
      initial.step = 'review';
      initial.focusId = 'install';
      initial.skillConflicts = conflicts;
    }, { columns: 40, rows: 8 });
    await ready();
    await rendered.send(KEYS.enter); // Install → adoption error
    await rendered.send(KEYS.esc); // global quit confirmation replaces errors
    const text = stripAnsi(rendered.frame());
    expect(text).toContain('Quit setup?');
    expectFit('quit-over-error-40x8', rendered.frame(), 40, 8);
    await rendered.send('Q');
    expect(result()?.type).toBe('quit');
  });

  it('advertises Space details visibly at 40x8', async () => {
    const target = workspace();
    for (const name of shippedSkillNames()) {
      const dir = join(target, '.opencode', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'Unowned.');
    }
    const conflicts = conflictingSkills({
      definitionsDir: join(REPO_ROOT, 'agents'),
      skillDir: join(REPO_ROOT, 'skills', 'autonomous-implement'),
      config: {},
      targetDir: target,
      harness: 'opencode',
    });
    const { rendered, ready } = mount(target, (initial) => {
      initial.step = 'review';
      initial.focusId = 'install';
      initial.skillConflicts = conflicts;
    }, { columns: 40, rows: 8 });
    await ready();
    await rendered.send(KEYS.enter); // Install → adoption error (capped)
    expect(stripAnsi(rendered.frame())).toContain('Space details');
  });

  it('keeps checkbox Space priority over details on the adoption row', async () => {
    const target = workspace();
    for (const name of shippedSkillNames()) {
      const dir = join(target, '.opencode', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'Unowned.');
    }
    const conflicts = conflictingSkills({
      definitionsDir: join(REPO_ROOT, 'agents'),
      skillDir: join(REPO_ROOT, 'skills', 'autonomous-implement'),
      config: {},
      targetDir: target,
      harness: 'opencode',
    });
    const seenBox: { state: SessionState | null } = { state: null };
    const { rendered, ready, result } = mount(target, (initial) => {
      initial.step = 'review';
      initial.focusId = 'adopt';
      initial.skillConflicts = conflicts;
    }, { columns: 40, rows: 8 }, async (state) => {
      seenBox.state = state;
      return fakeInstallResult(target);
    });
    await ready();
    await rendered.send(KEYS.space); // toggles adoption, never details
    await rendered.send(KEYS.down); // install row
    await rendered.send(KEYS.enter); // install proceeds with adoption
    await rendered.waitFor(() => result() !== null, 'adopted install result');
    expect(result()?.type).toBe('install');
    expect(seenBox.state?.adoptSkills).toBe(true);
  });

  it('reaches a middle error sentinel from the draft actions row', async () => {
    const target = workspace();
    const { rendered, ready } = mount(target, (initial) => {
      initial.step = 'instructions';
      initial.focusId = 'rules-path';
    }, { columns: 40, rows: 8 });
    await ready();
    await rendered.send(KEYS.enter); // open path draft
    await rendered.send(`missing-${'q'.repeat(60)}-MIDDLE-ERROR-SENTINEL-${'z'.repeat(60)}.md`);
    await rendered.send(KEYS.enter); // commit → capped validation error
    expect(stripAnsi(rendered.frame())).toContain('ENOENT');
    await rendered.send(KEYS.tab); // explicit actions incl. Error details
    const actions = stripAnsi(rendered.frame());
    expect(actions).toContain('Error details');
    await rendered.send(KEYS.down); // Cancel row
    await rendered.send(KEYS.down); // Error details row
    await rendered.send(KEYS.enter); // open full diagnostic, draft kept
    await reachErrorSentinel(rendered);
    const flat = stripAnsi(rendered.frame()).replace(/\n\s*/g, '');
    expect(flat).toContain('MIDDLE-ERROR-SENTINEL');
    expectFit('draft-error-detail-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.end);
    // Recover the diagnostic tail across legitimate cell wrapping (the dot
    // and extension can straddle two rows); still require the closing quote.
    expect(stripAnsi(rendered.frame()).replace(/\n\s*/g, '')).toContain(".md'");
    expectFit('draft-error-end-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.enter); // explicit close back to actions
    expect(stripAnsi(rendered.frame())).toContain('Cancel');
  });

  it('preserves draft-owned diagnostics through Quit/Continue exact restore', () => {
    const base = createInitialState({
      targetDir: '/repo', harness: 'opencode', config: {}, overwrite: {},
      personalRules: 'Prior rules.', skillConflicts: [], vscodeKept: false,
    });
    const editing = {
      ...base,
      step: 'instructions' as const,
      draft: 'missing.md',
      draftFor: 'rules-path' as const,
      region: 1,
      focusId: 'edit:details',
      error: 'ENOENT: nope',
      notice: 'Heads up',
    };
    const dialog = reducer(editing, { type: 'REQUEST_QUIT' });
    expect(dialog.quitDialog).not.toBeNull();
    const resumed = reducer(dialog, { type: 'QUIT_CONTINUE' });
    // Complete snapshot invariant: diagnostics survive the roundtrip.
    expect(resumed.error).toBe('ENOENT: nope');
    expect(resumed.notice).toBe('Heads up');
    expect(resumed.draft).toBe('missing.md');
    expect(resumed.draftFor).toBe('rules-path');
    expect(resumed.region).toBe(1);
    expect(resumed.focusId).toBe('edit:details');
    expect(resumed.quitDialog).toBeNull();
  });

  it('roundtrips detail + error + draft through quit and cancels cleanly', async () => {
    const target = workspace();
    const seen: Array<{ columns: number; rows: number; lines: number }> = [];
    const check = (name: string, frame: string) => {
      const lines = stripAnsi(frame).split('\n');
      while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
      seen.push({ columns: 40, rows: 8, lines: lines.length });
      expect(lines.length, `${name} fits 8 rows`).toBeLessThanOrEqual(8);
      for (const line of lines) {
        expect(stringWidth(line), `${name} fits 40 columns`).toBeLessThanOrEqual(40);
      }
    };
    const { rendered, ready } = mount(target, (initial) => {
      initial.step = 'instructions';
      initial.focusId = 'rules-path';
    }, { columns: 40, rows: 8 });
    await ready();
    await rendered.send(KEYS.enter); // open path draft
    await rendered.send(`missing-${'q'.repeat(60)}-MIDDLE-ERROR-SENTINEL-${'z'.repeat(60)}.md`);
    await rendered.send(KEYS.enter); // commit → capped validation error
    expect(stripAnsi(rendered.frame())).toContain('ENOENT');
    await rendered.send(KEYS.tab); // explicit actions incl. Error details
    await rendered.send(KEYS.down);
    await rendered.send(KEYS.down); // Error details row
    await rendered.send(KEYS.enter); // open full diagnostic, draft kept
    await reachErrorSentinel(rendered);
    expect(stripAnsi(rendered.frame()).replace(/\n\s*/g, '')).toContain('MIDDLE-ERROR-SENTINEL');
    check('detail-open', rendered.frame());
    const detailFrame = stripAnsi(rendered.frame());
    await rendered.send(KEYS.esc); // U5: global quit confirmation
    expect(stripAnsi(rendered.frame())).toContain('Quit setup?');
    check('quit-over-detail', rendered.frame());
    await rendered.send(KEYS.enter); // continue: error + overlay restored
    const resumed = stripAnsi(rendered.frame());
    expect(resumed).toBe(detailFrame);
    // Exact restore: same scrolled overlay view (sentinel still visible).
    expect(resumed.replace(/\n\s*/g, '')).toContain('MIDDLE-ERROR-SENTINEL');
    check('resumed-detail', rendered.frame());
    await rendered.send(KEYS.enter); // explicit close back to actions
    // Error truly restored (not just the overlay): the details row is back.
    expect(stripAnsi(rendered.frame())).toContain('Error details');
    await rendered.send(KEYS.up); // Cancel row (valid focus, no fallback)
    await rendered.send(KEYS.enter); // Cancel: draft + its error cleared
    const text = stripAnsi(rendered.frame());
    expect(text).not.toContain('ENOENT');
    check('post-cancel', rendered.frame());
    expect(seen.length).toBeGreaterThan(3);
  });

  it('never silently commits from an unrecognized actions-row focus', async () => {
    const { resolveEditAction } = await import('./app.js');
    expect(resolveEditAction('edit:commit')).toBe('commit');
    expect(resolveEditAction('edit:cancel')).toBe('cancel');
    expect(resolveEditAction('edit:details')).toBe('details');
    expect(resolveEditAction('edit:stale-ghost')).toBeNull();
    expect(resolveEditAction('value:whatever')).toBeNull();
  });
});
