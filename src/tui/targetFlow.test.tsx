import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import stringWidth from 'string-width';
import { InstallerApp, type AppResult } from './app.js';
import { createInitialState, type SessionState } from './state.js';
import { conflictingSkills } from '../installer/installTeam.js';
import { migratePlannerConfig } from '../installer/defaults.js';
import { planVscodeSettings } from '../installer/vscodeSettings.js';
import { HARNESS_LAYOUTS, type Harness } from '../installer/harness.js';
import { checkInstallPath } from '../installer/installPaths.js';
import type { InstallAllResult } from '../installer/installAll.js';
import { installAll } from '../installer/installAll.js';
import type { TeamConfig } from '../types.js';
import { KEYS, fakeInstallResult, renderTree, stripAnsi, type Rendered } from './testSupport.js';
import type { TargetRefreshLoader } from './screens/directory.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFINITIONS = join(REPO_ROOT, 'agents');
const SKILL_DIR = join(REPO_ROOT, 'skills', 'autonomous-implement');

const roots: string[] = [];
const live: Rendered[] = [];
afterEach(() => {
  while (live.length) live.pop()?.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(base = tmpdir()): string {
  const root = mkdtempSync(join(base, 't08-flow-'));
  roots.push(root);
  return root;
}

/** Production-like refresh: each target owns its saved config, conflicts and
 * editor status; persona stays user-scoped (never reloaded per target). */
const prodLoader: TargetRefreshLoader = (dir: string, harness: Harness) => {
  const configPath = join(dir, HARNESS_LAYOUTS[harness].config);
  checkInstallPath(dir, configPath);
  const saved: TeamConfig = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) as TeamConfig : {};
  return {
    config: migratePlannerConfig(saved),
    skillConflicts: conflictingSkills({ definitionsDir: DEFINITIONS, skillDir: SKILL_DIR, config: {}, targetDir: dir, overwrite: {}, harness }),
    vscodeKept: planVscodeSettings(dir).body === null,
  };
};

function mount(target: string, options: {
  overrides?: Record<string, unknown>;
  size?: { columns?: number; rows?: number };
  loadRefresh?: TargetRefreshLoader | null;
  catalog?: string[];
  seen?: { state: SessionState | null };
} = {}) {
  let done: AppResult | null = null;
  const seen = options.seen ?? { state: null as SessionState | null };
  const initial = createInitialState({
    targetDir: target,
    harness: 'opencode',
    config: {},
    overwrite: {},
        personalRules: '',
    skillConflicts: [],
    vscodeKept: true,
    ...options.overrides,
  });
  initial.discovery = { status: 'ready', models: options.catalog ?? ['opencode/alpha', 'opencode/beta'], detail: '' };
  const rendered = renderTree(
    React.createElement(InstallerApp, {
      initial,
      onDone: (result) => { done = result; },
      onInstall: async (state) => {
        seen.state = state;
        return fakeInstallResult(state.targetDir);
      },
      ...(options.loadRefresh === null ? {} : { loadRefresh: options.loadRefresh ?? prodLoader }),
    }),
    options.size,
  );
  live.push(rendered);
  return {
    rendered,
    seen,
    result: () => done,
    ready: async () => {
      return rendered.ready();
    },
    settled: async () => {
      await rendered.waitFor(() => done !== null, 'target install result');
      return done;
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

/** The browser always exposes its absolute path through its inspection pager.
 * Read all wrapped pieces in order, not the deliberately truncated summary.
 * Home/close leaves focus on the nonmutating inspection row. */
async function expectBrowsedPath(rendered: Rendered, path: string, columns = 100, rows = 39): Promise<void> {
  await rendered.send(KEYS.home);
  let frame = await rendered.send(KEYS.space);
  expect(stripAnsi(frame)).toContain('Browsed folder (inspection only)');
  let read = '';
  for (let page = 0; page < 128; page++) {
    expectFit('path pager', frame, columns, rows);
    const lines = stripAnsi(frame).split('\n').map((line) =>
      (columns === 100 ? [...line].slice(44).join('') : line).trim());
    for (const line of lines) {
      if (line && path.slice(read.length).startsWith(line)) read += line;
    }
    if (read === path) break;
    frame = await rendered.send(KEYS.down);
  }
  expect(read, 'all absolute-path pieces are rendered in order').toBe(path);
  await rendered.send(KEYS.enter);
}

async function expectInstallLabel(rendered: Rendered, target: string): Promise<void> {
  const before = stripAnsi(rendered.frame());
  let frame = await rendered.send(KEYS.space);
  const opened = stripAnsi(frame) !== before;
  const label = `Install into ${target}`;
  let read = '';
  for (let page = 0; page < 128; page++) {
    expectFit('install label/details', frame, 100, 39);
    for (const line of stripAnsi(frame).split('\n').map((row) => [...row].slice(44).join('').trim().replace(/^>\s*/, ''))) {
      const remaining = label.slice(read.length);
      const continuation = remaining.trimStart();
      if (line && continuation.startsWith(line)) read += remaining.slice(0, remaining.length - continuation.length) + line;
    }
    if (read === label || !opened) break;
    frame = await rendered.send(KEYS.down);
  }
  expect(read, `full install action label, through paging when capped\n${stripAnsi(frame)}`).toBe(label);
  if (opened) await rendered.send(KEYS.enter);
}

/** Walk from the agents list to review (assumes focus starts on a harness row). */
async function toReview(rendered: Rendered): Promise<void> {
  await rendered.send(KEYS.end); // __next__
  await rendered.send(KEYS.enter); // persona
  for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down); // __next__
  await rendered.send(KEYS.enter); // review
}

describe('single-target picker flow', () => {
  it.each([40, 100])('returns from edited Agents and cancels/resumes/confirms target consent at %s columns', async (columns) => {
    const targetA = workspace();
    const targetB = join(targetA, 'project-b');
    mkdirSync(targetB);
    const mounted = mount(targetA, {
      size: { columns, rows: columns === 40 ? 8 : 39 },
      loadRefresh: () => ({ config: { lead: { model: 'saved/b' } }, skillConflicts: ['wayfinder'], vscodeKept: false }),
    });
    const { rendered, seen } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.enter); // Agents
    for (let i = 0; i < 5; i++) await rendered.send(KEYS.down); // lead
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.home); // inherit
    await rendered.send(KEYS.down); // alpha
    await rendered.send(KEYS.enter); // commit edited model
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter); // editor Back
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.up); // bounded Agents Back
    expect(stripAnsi(rendered.frame())).toContain('Back to installation');
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // browser
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.up); // same-target Use
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.down); // close restores Choose; move to confirm
    await rendered.send(KEYS.enter); // Agents again
    await rendered.send(KEYS.home);
    for (let i = 0; i < 5; i++) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // inspect committed choice even with hidden hints
    await rendered.send(KEYS.home);
    await rendered.send(KEYS.down);
    expect(stripAnsi(rendered.frame())).toContain('opencode/alpha');
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // Back
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.down); // parent
    await rendered.send(KEYS.down); // B
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.up);
    let text = stripAnsi(await rendered.send(KEYS.enter)); // consent
    expectFit('consent', text, columns, columns === 40 ? 8 : 39);
    expect(text).toMatch(/discard|Discard|replaces/);
    const consentFrame = text;
    let explanation = stripAnsi(await rendered.send(KEYS.space));
    expectFit('consent details', explanation, columns, columns === 40 ? 8 : 39);
    const explanationContent = () => (columns === 100
      ? explanation.split('\n').map((line) => [...line].slice(44).join('')).join('')
      : explanation).replace(/\s/g, '');
    // Stop only when the existing full-text oracle is visible; an unreachable
    // explanation still exhausts the same bounded 20 inputs and fails below.
    let explanationInputs = 0;
    while (explanationInputs < 20 && !explanationContent().includes('savedconfig/defaults')) {
      const next = stripAnsi(await rendered.send(KEYS.down));
      expectFit('consent details scan', next, columns, columns === 40 ? 8 : 39);
      explanation += next;
      explanationInputs += 1;
    }
    expect(explanationContent()).toContain('savedconfig/defaults');
    await rendered.send(KEYS.enter); // nonmutating details close
    await rendered.send(KEYS.esc);
    text = stripAnsi(await rendered.send(KEYS.enter)); // exact consent restore
    expect(text).toBe(consentFrame);
    await rendered.send(KEYS.end);
    text = stripAnsi(await rendered.send(KEYS.enter)); // Cancel retains browsed B
    expect(text).toContain('Directory:');
    const browserFrame = text;
    await rendered.send(KEYS.esc);
    expect(stripAnsi(await rendered.send(KEYS.enter))).toBe(browserFrame);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter); // picker Cancel -> still A
    await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // Agents: old edited config still committed
    await rendered.send(KEYS.home);
    for (let i = 0; i < 5; i++) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.home);
    await rendered.send(KEYS.down);
    expect(stripAnsi(rendered.frame())).toContain('opencode/alpha');
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // Back with A still authoritative
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.down);
    await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // browse B again
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // Use -> consent again
    await rendered.send(KEYS.enter); // Confirm -> target B
    await rendered.send(KEYS.enter); // Agents
    await toReview(rendered);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.up); // explicit conflict adoption
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter);
    expect((await mounted.settled())?.type).toBe('install');
    expect(seen.state?.targetDir).toBe(targetB);
    expect(seen.state?.config.lead?.model).toBe('saved/b');
    expect(seen.state?.skillConflicts).toEqual(['wayfinder']);
    expect(seen.state?.vscodeKept).toBe(false);
    expect(readdirSync(targetA)).toEqual(['project-b']);
    expect(readdirSync(targetB)).toEqual([]);
  }, 20000);

  it.each([40, 100])('inspects the full browsed absolute path without selecting at %s columns', async (columns) => {
    const root = workspace();
    const target = join(root, 'start-sentinel-' + 'long-segment-'.repeat(12) + '-end-sentinel');
    mkdirSync(target);
    const mounted = mount(target, { size: { columns, rows: columns === 40 ? 8 : 39 } });
    const { rendered } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.home); // inspection row
    const before = stripAnsi(rendered.frame());
    expect(stripAnsi(await rendered.send(KEYS.enter))).toBe(before);
    await expectBrowsedPath(rendered, target, columns, columns === 40 ? 8 : 39);
    expectFit('detail', rendered.frame(), columns, columns === 40 ? 8 : 39);
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter); // Cancel, not Use
    expect(mounted.result()).toBeNull();
    expect(readdirSync(target)).toEqual([]);
  }, 20000);

  it.each(['configured TMPDIR', 'long TMPDIR-style parent'])('installs the picked folder B, leaves cwd A untouched, and loads B saved config (%s)', async (tempCase) => {
    let base = tmpdir();
    if (tempCase === 'long TMPDIR-style parent') {
      base = join(workspace(), 'tmpdir-start-sentinel', 'long-temp-segment-'.repeat(10), 'tmpdir-end-sentinel');
      mkdirSync(base, { recursive: true });
    }
    const targetA = workspace(base);
    const targetB = join(targetA, 'project-b');
    mkdirSync(targetB, { recursive: true });
    mkdirSync(join(targetB, '.opencode'), { recursive: true });
    writeFileSync(join(targetB, '.opencode', 'team.config.json'), JSON.stringify({ lead: { model: 'other/b-model' } }));

    const mounted = mount(targetA);
    const { rendered, seen, settled } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.up); // change row
    await rendered.send(KEYS.enter); // open picker at A
    let text = stripAnsi(rendered.frame());
    expect(text).toContain('Directory:');
    await expectBrowsedPath(rendered, targetA);
    await rendered.send(KEYS.down); // .. (parent)
    await rendered.send(KEYS.down); // project-b/
    await rendered.send(KEYS.enter); // navigate into B (no switch yet)
    text = stripAnsi(rendered.frame());
    expect(text).toContain('Directory:');
    await expectBrowsedPath(rendered, targetB);
    expect(text).toContain('Use this folder');
    await rendered.send(KEYS.down); // ..
    await rendered.send(KEYS.down); // Show hidden
    await rendered.send(KEYS.down); // Use this folder
    text = stripAnsi(await rendered.send(KEYS.enter)); // explicit use
    await expectInstallLabel(rendered, targetB);
    expect(text).not.toContain('Quit setup?');
    await rendered.send(KEYS.enter); // confirm -> agents
    text = stripAnsi(rendered.frame());
    expect(text).toContain('Step 2 of 4');
    await toReview(rendered);
    text = stripAnsi(rendered.frame());
    expect(text).toContain('Step 4 of 4');
    // The confirmed target owns the review: B's saved model, B's target line.
    await rendered.send(KEYS.home); // window to the top rows
    text = stripAnsi(rendered.frame());
    expect(text).toContain('Target:');
    await rendered.send(KEYS.down); // analyst
    text = stripAnsi(await rendered.send(KEYS.down)); // focus B's lead model
    expect(text).toMatch(/>\s+lead: other\/b-model/);
    await rendered.send(KEYS.end); // last row is back; step up to install
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // install
    const outcome = await settled();
    expect(outcome?.type).toBe('install');
    expect(seen.state?.targetDir).toBe(targetB);
    expect(seen.state?.config.lead?.model).toBe('other/b-model');
    expect(outcome).toMatchObject({ type: 'install', installResult: { target: targetB } });
    // Nothing was written at the invocation cwd: only the picked folder existed.
    expect(readdirSync(targetA).sort()).toEqual(['project-b']);
    expect(existsSync(join(targetA, '.opencode'))).toBe(false);
    expect(existsSync(join(targetA, '.vscode'))).toBe(false);
  }, 20000);

  it('keeps the same target and committed choices when reusing the invocation folder', async () => {
    const targetA = workspace();
    const mounted = mount(targetA, { overrides: { config: { analyst: { model: 'openai/gpt-5' } } } });
    const { rendered } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // open picker at A
    await rendered.send(KEYS.down); // .. (parent)
    await rendered.send(KEYS.down); // Show hidden (only .. entry)
    await rendered.send(KEYS.down); // Use this folder
    await rendered.send(KEYS.enter); // same dir: keep, no reload; focus on change
    await rendered.send(KEYS.down); // focus confirmation
    await expectInstallLabel(rendered, targetA);
    await rendered.send(KEYS.enter); // agents
    await toReview(rendered);
    // Committed session choice survived the same-target roundtrip.
    await rendered.send(KEYS.home); // window to the top rows
    expect(stripAnsi(rendered.frame())).toContain('openai/gpt-5');
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter);
    expect(await mounted.settled()).toMatchObject({ type: 'install', state: { targetDir: targetA, config: { analyst: { model: 'openai/gpt-5' } } } });
  });

  it('cancels the picker with target and config unchanged, then quits cleanly', async () => {
    const targetA = workspace();
    const targetB = join(targetA, 'project-b');
    mkdirSync(targetB, { recursive: true });
    const mounted = mount(targetA, { overrides: { config: { lead: { model: 'saved/a' } } } });
    const { rendered, result } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // open picker
    await rendered.send(KEYS.down); // .. (parent)
    await rendered.send(KEYS.down); // project-b/
    await rendered.send(KEYS.enter); // navigate (no switch)
    await rendered.send(KEYS.end); // Cancel row
    let text = stripAnsi(await rendered.send(KEYS.enter)); // explicit cancel
    expect(text).not.toContain('Quit setup?');
    expect(text).toContain('Choose another target folder');
    const closedFrame = text;
    await rendered.send(KEYS.esc); // global quit dialog
    text = stripAnsi(rendered.frame());
    expect(text).toContain('Quit setup?');
    text = stripAnsi(await rendered.send(KEYS.enter)); // continue restores exactly
    expect(text).not.toContain('Quit setup?');
    expect(text).toBe(closedFrame);
    const focused = stripAnsi(await rendered.send(KEYS.down));
    await expectInstallLabel(rendered, targetA);
    expect(stripAnsi(rendered.frame())).toBe(focused);
    await rendered.send(KEYS.up);
    expect(stripAnsi(rendered.frame())).toBe(closedFrame);
    await rendered.send(KEYS.esc);
    await rendered.send('Q');
    expect(result()?.type).toBe('quit');
    expect(result()).toMatchObject({ type: 'quit', state: { targetDir: targetA, config: { lead: { model: 'saved/a' } } } });
    expect(readdirSync(targetA).sort()).toEqual(['project-b']);
  });

  it('restores the open browser and browsed directory through quit-continue', async () => {
    const targetA = workspace();
    const targetB = join(targetA, 'project-b');
    mkdirSync(targetB, { recursive: true });
    const mounted = mount(targetA);
    const { rendered, result } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // open picker at A
    await rendered.send(KEYS.down); // .. (parent)
    await rendered.send(KEYS.down); // project-b/
    await rendered.send(KEYS.enter); // navigate into B
    const browserFrame = stripAnsi(rendered.frame());
    // Esc follows the global safe-quit contract even inside the picker.
    let text = stripAnsi(await rendered.send(KEYS.esc));
    expect(text).toContain('Quit setup?');
    expect(result()).toBeNull();
    text = stripAnsi(await rendered.send(KEYS.enter)); // continue
    expect(text).not.toContain('Quit setup?');
    // Exact restore: the browser is still open at the browsed directory.
    expect(text).toBe(browserFrame);
    expect(text).toContain('Directory:');
    expect(text).toContain('Use this folder');
    await expectBrowsedPath(rendered, targetB);
    await rendered.send(KEYS.esc);
    await rendered.send('Q');
    expect(result()).toMatchObject({ type: 'quit', state: { targetDir: targetA, targetBrowser: { open: true, dir: targetB } } });
  });

  it('recovers from a vanishing browsed folder with the committed target intact', async () => {
    const targetA = workspace();
    const targetB = join(targetA, 'project-b');
    mkdirSync(targetB, { recursive: true });
    const mounted = mount(targetA);
    const { rendered, result } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.down); // .. (parent)
    await rendered.send(KEYS.down); // project-b/
    await rendered.send(KEYS.enter); // navigate into B
    rmSync(targetB, { recursive: true, force: true });
    await rendered.send(KEYS.down); // .. (parent)
    await rendered.send(KEYS.down); // Show hidden -> recompute entries -> read error
    const text = stripAnsi(await rendered.send(KEYS.enter));
    expect(text).toMatch(/ENOENT|Cannot read/);
    expect(text).not.toContain('Quit setup?');
    expect(result()).toBeNull();
    await rendered.send(KEYS.end); // Cancel row
    const closed = stripAnsi(await rendered.send(KEYS.enter));
    expect(closed).toContain('Choose another target folder');
    expect(result()).toBeNull();
    const focused = stripAnsi(await rendered.send(KEYS.down));
    await expectInstallLabel(rendered, targetA);
    expect(stripAnsi(rendered.frame())).toBe(focused);
    await rendered.send(KEYS.up);
    expect(stripAnsi(rendered.frame())).toBe(closed);
    await rendered.send(KEYS.esc);
    await rendered.send('Q');
    expect(result()).toMatchObject({ type: 'quit', state: { targetDir: targetA, config: {}, targetBrowser: { open: false } } });
    expect(readdirSync(targetA)).toEqual([]);
  });

  it('never lists symlinked directories as install targets', async () => {
    const targetA = workspace();
    mkdirSync(join(targetA, 'real'));
    symlinkSync(targetA, join(targetA, 'loop'), 'dir');
    const mounted = mount(targetA);
    const { rendered } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.home);
    let text = stripAnsi(await rendered.send(KEYS.down)); // parent
    expect(text).not.toContain('loop');
    text = stripAnsi(await rendered.send(KEYS.down)); // first child, not a link
    expect(text).toContain('real/');
    expect(text).not.toContain('loop');
    expect(text).toMatch(/>\s+real\//);
    text = stripAnsi(await rendered.send(KEYS.down));
    expect(text).toMatch(/>\s+Show hidden entries/); // no second child/link
    expect(text).not.toContain('loop');
  });

  it('refreshes skill conflicts when the harness changes', async () => {
    const targetA = workspace();
    const harnessLoader: TargetRefreshLoader = (dir, harness) => ({
      ...prodLoader(dir, harness),
      skillConflicts: harness === 'opencode' ? ['wayfinder'] : [],
    });
    const mounted = mount(targetA, { loadRefresh: harnessLoader });
    const { rendered } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.enter); // agents (focus opencode)
    await rendered.send(KEYS.down); // claude-code
    await rendered.send(KEYS.down); // codex
    await rendered.send(KEYS.enter); // switch harness -> conflicts refresh
    await toReview(rendered);
    const text = stripAnsi(rendered.frame());
    expect(text).toContain('.codex/agents/');
    expect(text).not.toContain('Adopt/replace unowned skill folders');
  });
});

describe('target picker small viewport', () => {
  it('offers only custom instructions and no voice toggle', async () => {
    const target = workspace();
    const mounted = mount(target);
    const { rendered } = mounted;
    await mounted.ready();
    await rendered.send(KEYS.enter); // agents
    await toReview(rendered);
    await rendered.send(KEYS.end); // back
    await rendered.send(KEYS.enter); // instructions
    let text = stripAnsi(rendered.frame());
    expect(text).toContain('Browse for a rules file');
    expect(text).not.toContain('Toady voice');
    await rendered.send(KEYS.home); // browse
    text = stripAnsi(await rendered.send(KEYS.enter));
    expect(text).toContain('Directory:');
  });
});

describe('target picker small viewport', () => {
  it('fits the open picker with long paths at 40x8', async () => {
    const targetA = workspace();
    const long = join(targetA, `very-long-project-name-that-keeps-going-0123456789-${'x'.repeat(40)}`);
    mkdirSync(long, { recursive: true });
    const mounted = mount(targetA, { size: { columns: 40, rows: 8 } });
    const { rendered } = mounted;
    await mounted.ready();
    expectFit('target-closed-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.up);
    await rendered.send(KEYS.enter); // open picker
    expectFit('target-browser-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.down); // .. (parent)
    await rendered.send(KEYS.down); // the long folder
    await rendered.send(KEYS.enter); // navigate into the long folder
    expectFit('target-browser-long-40x8', rendered.frame(), 40, 8);
  });
});
