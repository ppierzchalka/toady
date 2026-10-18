import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstallerApp, type AppResult } from './app.js';
import { createInitialState, type SessionState } from './state.js';
import { KEYS, fakeInstallResult, renderTree, stripAnsi, type Rendered } from './testSupport.js';

import type { InstallAllResult } from '../installer/installAll.js';

const roots: string[] = [];
const live: Rendered[] = [];
afterEach(() => {
  while (live.length) live.pop()?.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'tui-app-'));
  roots.push(root);
  return root;
}

function mount(target: string, overrides: Record<string, unknown> = {}, size: { columns?: number; rows?: number } = {}, onInstall?: (state: SessionState) => Promise<InstallAllResult>, catalog: string[] = ['opencode/alpha', 'opencode/beta']) {
  let done: AppResult | null = null;
  let installed: unknown = null;
  const initial = createInitialState({
    targetDir: target,
    harness: 'opencode',
    config: {},
    overwrite: {},
        personalRules: '',
    skillConflicts: [],
    vscodeKept: true,
    ...overrides,
  });
  // Deterministic catalog: skip the async host discovery in behavior tests.
  initial.discovery = { status: 'ready', models: catalog, detail: `${catalog.length} models from configured providers` };
  const handler = onInstall ?? (() => {
    installed = { stub: true };
    return Promise.resolve(fakeInstallResult(target));
  });
  const rendered = renderTree(
    React.createElement(InstallerApp, { initial, onDone: (result) => { done = result; }, onInstall: handler }),
    size,
  );
  live.push(rendered);
  return {
    rendered,
    result: () => done,
    installed: () => installed,
    ready: async () => {
      return rendered.ready();
    },
    settled: async () => {
      await rendered.waitFor(() => done !== null, 'install or quit result');
      return done;
    },
  };
}

describe('native installer app', () => {
  it('starts with recommended selections after asynchronous discovery without applying defaults manually', async () => {
    const target = workspace();
    const initial = createInitialState({ targetDir: target, harness: 'opencode', config: {}, overwrite: {}, personalRules: '', skillConflicts: [], vscodeKept: true });
    let result: AppResult | null = null;
    const rendered = renderTree(<InstallerApp initial={initial} onDone={value => { result = value; }} discover={async () => ({ models: ['openai/gpt-6.1-sol'], detail: 'Discovery complete' })} />);
    live.push(rendered);
    await rendered.ready();
    await rendered.send(KEYS.enter);
    await rendered.waitFor(() => stripAnsi(rendered.frame()).includes('gpt-6.1-sol'), 'automatically selected recommended model');
    await rendered.send(KEYS.ctrlC);
    await rendered.send('q');
    const state = (result as AppResult | null)?.state;
    expect(state?.config.lead).toEqual({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' });
    expect(state?.settingsTouched).toBe(false);
    expect(readdirSync(target)).toEqual([]);
  });

  it('U09-1: warning inspection preserves checkbox toggles and full error precedence', async () => {
    const target = workspace();
    const initial = createInitialState({ targetDir: target, harness: 'opencode', config: {}, overwrite: {}, personalRules: '', skillConflicts: ['wayfinder'], vscodeKept: true });
    initial.discovery = { status: 'ready', models: [], detail: '' };
    initial.step = 'review';
    initial.focusId = 'adopt';
    initial.notice = 'Warning: retain this complete advisory while inspecting an error.';
    initial.error = 'error-start ' + 'full diagnostic context '.repeat(40) + 'error-end';
    let result: AppResult | null = null;
    const rendered = renderTree(<InstallerApp initial={initial} onDone={(value) => { result = value; }} />, { columns: 40, rows: 8 });
    live.push(rendered);
    await rendered.ready();
    const toggled = stripAnsi(await rendered.send(KEYS.space));
    expect(toggled).toContain('[x]');
    expect(toggled).not.toContain('Error details');
    await rendered.send(KEYS.down); // install action, not the checkbox
    const action = stripAnsi(rendered.frame());
    expect(action).toContain('Space details');
    expect(action).not.toContain('Space warning/details');
    expect(stripAnsi(await rendered.send(KEYS.space))).toContain('Error details');
    await rendered.send(KEYS.ctrlC);
    await rendered.send('q');
    const inspected = (result as AppResult | null)?.state;
    expect(inspected?.detail?.title).toBe('Error details');
    expect(inspected?.detail?.lines.join(' ')).toContain('error-start');
    expect(inspected?.detail?.lines.join(' ')).toContain('error-end');
    expect(inspected?.detail?.lines.join(' ')).not.toContain(initial.notice);
    expect(inspected?.notice).toBe(initial.notice);
    expect(inspected?.error).toBe(initial.error);
    expect(inspected?.adoptSkills).toBe(true);
    expect(inspected?.config).toEqual(initial.config);
    expect(inspected?.targetDir).toBe(target);
    expect(inspected?.installRequested).toBe(false);
    expect(existsSync(join(target, '.opencode'))).toBe(false);
  });

  it('shows the cwd confirmation first with directory-only shortcuts', async () => {
    const target = workspace();
    const { rendered, ready, result, installed } = mount(target);
    await ready();
    const text = stripAnsi(rendered.frame());
    expect(text).toContain('Step 1 of 4');
    expect(text).toContain('Target (defaults to the invocation directory):');
    expect(text).toContain('Enter activate');
    expect(text).not.toContain('inquirer');
    // The bounded static summary is not the full-path oracle. Inspect the
    // focused confirmation through its existing Space route, including every
    // middle path component, then restore without activating installation.
    const label = `Install into ${target}`;
    let frame = stripAnsi(await rendered.send(KEYS.space));
    const opened = frame !== text;
    let read = '';
    for (let page = 0; page < 128; page++) {
      for (const line of frame.split('\n').map(row => [...row].slice(44).join('').trim().replace(/^>\s*/, ''))) {
        const remaining = label.slice(read.length);
        const continuation = remaining.trimStart();
        if (line && continuation.startsWith(line)) read += remaining.slice(0, remaining.length - continuation.length) + line;
      }
      if (read === label || !opened) break;
      frame = stripAnsi(await rendered.send(KEYS.down));
    }
    expect(read, 'full confirmation path through visible details').toBe(label);
    if (opened) await rendered.send(KEYS.enter);
    expect(stripAnsi(rendered.frame())).toBe(text);
    expect(result()).toBeNull();
    expect(installed()).toBeNull();
    expect(readdirSync(target)).toEqual([]);
  });

  it('walks directory confirmation to agents with Enter and Home/End navigation', async () => {
    const target = workspace();
    const { rendered, ready } = mount(target);
    await ready();
    let text = stripAnsi(await rendered.send(KEYS.enter));
    expect(text).toContain('Step 2 of 4');
    text = stripAnsi(await rendered.send(KEYS.end));
    expect(text).toContain('Next: personal instructions');
    text = stripAnsi(await rendered.send(KEYS.home));
    expect(text).toContain('Harness: opencode');
  });

  it('opens an agent editor, commits a model with Enter and keeps it on Back', async () => {
    const target = workspace();
    const { rendered, ready } = mount(target);
    await ready();
    await rendered.send(KEYS.enter); // directory -> agents
    // Focus analyst: harness rows (5) precede roles; move down 5 times.
    for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // open analyst editor
    let text = stripAnsi(rendered.frame());
    expect(text).toContain('analyst — unset (inherit harness model)');
    // Editor values: inherit first, then catalog; focus opencode/alpha.
    await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // commit opencode/alpha
    await rendered.send(KEYS.esc); // back to the role list (no quit dialog)
    text = stripAnsi(rendered.frame());
    expect(text).not.toContain('Quit setup?');
    expect(text).toContain('opencode/alpha');
  });

  it('asks before quitting, continues with the draft intact, and quits with Q', async () => {
    const target = workspace();
    const { rendered, result, ready } = mount(target);
    await ready();
    await rendered.send(KEYS.enter); // agents
    let text = stripAnsi(await rendered.send(KEYS.esc));
    expect(text).toContain('Quit setup?');
    expect(result()).toBeNull();
    text = stripAnsi(await rendered.send(KEYS.enter)); // safe-default continue
    expect(text).not.toContain('Quit setup?');
    expect(text).toContain('Step 2 of 4');
    await rendered.send(KEYS.esc);
    await rendered.send('Q');
    expect(result()?.type).toBe('quit');
    // No-write cancellation: the target has no team files.
    expect(existsSync(join(target, '.opencode'))).toBe(false);
    expect(existsSync(join(target, '.vscode'))).toBe(false);
  });

  it('runs validation and writes inside the mounted shell, then exits to install', async () => {
    const target = workspace();
    const seenBox: { state: SessionState | null } = { state: null };
    const { rendered, result, ready, settled } = mount(target, {}, {}, async (state) => {
      seenBox.state = state;
      return fakeInstallResult(target);
    });
    await ready();
    await rendered.send(KEYS.enter); // agents
    await rendered.send(KEYS.end); // __next__
    await rendered.send(KEYS.enter); // persona
    // instructions menu: browse, path, clear, __next__(3 downs), back
    for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // review
    let text = stripAnsi(rendered.frame());
    expect(text).toContain('Step 4 of 4');
    expect(text).toContain('Project writes (this folder)');
    await rendered.send(KEYS.enter); // install row has initial focus: validating → writing
    const outcome = await settled();
    text = stripAnsi(rendered.frame());
    expect(outcome?.type).toBe('install');
    expect(seenBox.state).not.toBeNull();
    if (outcome?.type === 'install') {
      expect(outcome.installResult.target).toBe(target);
    }
    // The shell itself writes nothing; the injected writer owns the writes.
    expect(existsSync(join(target, '.opencode'))).toBe(false);
    expect(readdirSync(target)).toEqual([]);
    expect(text).toContain('Step 4 of 4');
  });

  it('reports install failures after terminal restoration without hanging', async () => {
    const target = workspace();
    const { rendered, result, ready, settled } = mount(target, {}, {}, async () => {
      throw new Error('Installation failed for /repo: disk full. The target may be partially written.');
    });
    await ready();
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter);
    for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.enter);
    const outcome = await settled();
    expect(outcome?.type).toBe('install-error');
    if (outcome?.type === 'install-error') expect(outcome.error).toContain('partially written');
  });

  it('opens the safe quit dialog from a text draft and continues with it intact', async () => {
    const target = workspace();
    const { rendered, result, ready } = mount(target);
    await ready();
    await rendered.send(KEYS.enter); // agents
    for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // open analyst editor (focus lands on inherit)
    for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // __custom__ → model-custom draft
    await rendered.send('half-typed-id');
    const text = stripAnsi(await rendered.send(KEYS.esc)); // global safe quit, draft kept
    expect(text).toContain('Quit setup?');
    expect(result()).toBeNull();
    const resumed = stripAnsi(await rendered.send(KEYS.enter)); // continue restores draft
    expect(resumed).toContain('half-typed-id');
  });

  it('browses rules files natively, commits loader-validated content, cancels cleanly', async () => {
    const target = workspace();
    writeFileSync(join(target, 'rules.md'), 'Follow the custom format.');
    mkdirSync(join(target, 'empty'));
    const { rendered, ready } = mount(target);
    await ready();
    await rendered.send(KEYS.enter); // agents
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter); // persona (focus toady)
        await rendered.send(KEYS.enter); // open browser at target
    let text = stripAnsi(rendered.frame());
    expect(text).toContain('rules.md');
    // entries: .. first, then dirs (empty/), then files; move to rules.md.
    await rendered.send(KEYS.down); // empty/
    await rendered.send(KEYS.down); // rules.md
    await rendered.send(KEYS.enter); // commit file
    text = stripAnsi(rendered.frame());
    expect(text).toContain('Current rules: loaded');
    // Reopen and cancel with Esc: prior rules survive, no quit dialog.
    await rendered.send(KEYS.enter); // focus is rules-browse again? reopen
    text = stripAnsi(rendered.frame());
    if (text.includes('rules.md') && text.includes('Directory:')) {
      await rendered.send(KEYS.esc);
      text = stripAnsi(rendered.frame());
      expect(text).not.toContain('Quit setup?');
      expect(text).toContain('Current rules: loaded');
    }
  });

  it('shows a minimal resize state below 40x8 and preserves the session', async () => {
    const target = workspace();
    const { rendered } = mount(target, {}, { columns: 120, rows: 40 });
    await rendered.send(KEYS.enter); // agents
    const text = stripAnsi(await rendered.resize(30, 20));
    expect(text).toContain('Terminal too small');
    expect(text).toContain('session is');
    expect(text).toContain('be written');
    // Growing again restores the same step without writes or installation.
    const restored = stripAnsi(await rendered.resize(120, 40));
    expect(restored).toContain('Step 2 of 4');
    expect(existsSync(join(target, '.opencode'))).toBe(false);
  });

  it('hides the avatar at 99 columns and shows it at 120x45', async () => {
    const target = workspace();
    const narrowMount = mount(target, {}, { columns: 99, rows: 24 });
    await narrowMount.ready();
    expect(stripAnsi(narrowMount.rendered.frame())).not.toContain('▇');
    const wideMount = mount(target, {}, { columns: 120, rows: 45 });
    await wideMount.ready();
    const frame = stripAnsi(wideMount.rendered.frame());
    expect(frame).toContain('Step 1 of 4');
  });

  it('toggles skill adoption with Space on the review checkbox', async () => {
    const target = workspace();
    const seenBox: { state: SessionState | null } = { state: null };
    const { rendered, result, ready, settled } = mount(target, { skillConflicts: ['wayfinder'] }, {}, async (state) => {
      seenBox.state = state;
      return fakeInstallResult(target);
    });
    await ready();
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter);
    for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // review, focus on install
    await rendered.send(KEYS.up); // adopt row
    let text = stripAnsi(rendered.frame());
    expect(text).toContain('Adopt/replace unowned skill folders');
    await rendered.send(KEYS.space); // Space toggles adoption
    await rendered.send(KEYS.down); // install row
    await rendered.send(KEYS.enter); // install now allowed
    expect((await settled())?.type).toBe('install');
    expect(seenBox.state?.adoptSkills).toBe(true);
  });

  it('shows no Tab search hint where no search exists', async () => {
    const target = workspace();
    const { rendered, ready } = mount(target, { harness: 'codex' });
    await ready();
    await rendered.send(KEYS.enter); // agents
    for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // open analyst editor (codex)
    const text = stripAnsi(rendered.frame());
    expect(text).not.toContain('Tab search');
  });

  async function openAnalystSearch(target: string) {
    const mounted = mount(target, { config: { analyst: { model: 'openai/gpt-5' } } }, {});
    await mounted.ready();
    await mounted.rendered.send(KEYS.enter); // agents
    for (let i = 0; i < 5; i += 1) await mounted.rendered.send(KEYS.down);
    await mounted.rendered.send(KEYS.enter); // open analyst editor
    await mounted.rendered.send(KEYS.tab); // search region
    return mounted;
  }

  it('cancels a custom model draft explicitly, keeping the committed model', async () => {
    const target = workspace();
    const { rendered, ready } = mount(target, { config: { analyst: { model: 'openai/gpt-5' } } }, {});
    await ready();
    await rendered.send(KEYS.enter);
    for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // open analyst editor
    for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // __custom__ → model-custom draft
    await rendered.send('abandon-this-id');
    let text = stripAnsi(await rendered.send(KEYS.tab)); // explicit actions
    expect(text).toContain('Cancel');
    await rendered.send(KEYS.down); // Cancel row
    text = stripAnsi(await rendered.send(KEYS.enter)); // discard only the draft
    expect(text).not.toContain('Quit setup?');
    expect(text).toContain('analyst — openai/gpt-5');
  });

  it('cancels a rules-path draft explicitly, keeping prior rules', async () => {
    const target = workspace();
    writeFileSync(join(target, 'rules.md'), 'Keep me.');
    const { rendered, ready } = mount(target, { personalRules: 'Keep me.' }, {});
    await ready();
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter); // persona
    await rendered.send(KEYS.down); // rules-path row
    await rendered.send(KEYS.enter); // open path draft
    await rendered.send('missing.md');
    await rendered.send(KEYS.tab); // explicit actions
    await rendered.send(KEYS.down); // Cancel row
    const text = stripAnsi(await rendered.send(KEYS.enter));
    expect(text).toContain('Current rules: loaded');
    expect(text).not.toContain('Quit setup?');
  });

  it('F04: Enter in the search region commits the advertised custom query', async () => {
    const target = workspace();
    const { rendered } = await openAnalystSearch(target);
    await rendered.send('zzz-brain'); // unmatched vendor/custom query
    const text = stripAnsi(await rendered.send(KEYS.enter));
    // Must commit the typed custom ID — never the stale list focus, never
    // a silent clear to inheritance.
    expect(text).toContain('analyst — zzz-brain');
  });

  it('F04: Enter in the search region commits an exact match', async () => {
    const target = workspace();
    const { rendered } = await openAnalystSearch(target);
    await rendered.send('openai/beta');
    const text = stripAnsi(await rendered.send(KEYS.enter));
    expect(text).toContain('analyst — openai/beta');
  });

  it('F04: empty search Enter commits nothing and preserves the model', async () => {
    const target = workspace();
    const { rendered } = await openAnalystSearch(target);
    const text = stripAnsi(await rendered.send(KEYS.enter));
    expect(text).toContain('analyst — openai/gpt-5');
  });

  it('F05: avatar-adjacent focused model wraps at the menu column, suffix kept', async () => {
    const target = workspace();
    const { rendered, ready } = mount(target, {}, { columns: 100, rows: 39 }, undefined, [
      'opencode/alpha-model-with-a-quite-long-identifier-0123456789',
      'other/beta',
    ]);
    await ready();
    await rendered.send(KEYS.enter); // agents
    for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // open analyst editor
    await rendered.send(KEYS.down); // focus the long alpha model
    const text = stripAnsi(rendered.frame());
    // Full value wraps inside the menu column — never suffix-truncated.
    // (Continuation lines carry their row's avatar cells; assert fragments.)
    expect(text).toContain('opencode/alpha-model-with-a-quite-long-identifier');
    expect(text).toContain('-0123456789');
    expect(text).not.toMatch(/identifier-01…/);
  });

  it('F04: custom search commit survives to install without silent clearing', async () => {
    const target = workspace();
    const seenBox: { state: SessionState | null } = { state: null };
    const mounted = mount(target, { config: { analyst: { model: 'openai/gpt-5' } } }, {}, async (state) => {
      seenBox.state = state;
      return fakeInstallResult(target);
    });
    await mounted.ready();
    const { rendered, settled } = mounted;
    await rendered.send(KEYS.enter);
    for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.tab);
    await rendered.send('zzz-brain');
    await rendered.send(KEYS.enter); // commit custom
    await rendered.send(KEYS.esc); // clear search, back to list region
    await rendered.send(KEYS.esc); // back to role list
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter); // persona
    for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // review
    await rendered.send(KEYS.enter); // install
    expect((await settled())?.type).toBe('install');
    expect(seenBox.state?.config.analyst?.model).toBe('zzz-brain');
  });
});
