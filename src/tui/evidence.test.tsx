import React from 'react';
import { MenuList } from './components/controls.js';
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstallerApp, type AppResult } from './app.js';
import { createInitialState, type SessionState } from './state.js';
import type { InstallAllResult } from '../installer/installAll.js';
import { KEYS, fakeInstallResult, renderTree, stripAnsi, type Rendered } from './testSupport.js';

import stringWidth from 'string-width';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR ?? '/tmp/opencode/evidence';
const roots: string[] = [];
const live: Rendered[] = [];
afterEach(() => {
  while (live.length) live.pop()?.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'tui-evidence-'));
  roots.push(root);
  return root;
}

async function capture(name: string, size: { columns: number; rows: number }, drive: (rendered: Rendered) => Promise<void>, setup?: (target: string) => void, env?: Record<string, string | undefined>, models: string[] = ['opencode/alpha-model-with-a-quite-long-identifier-0123456789', 'other/beta'], onInstall?: (state: SessionState) => Promise<InstallAllResult>): Promise<{ stripped: string; raw: string }> {
  const target = workspace();
  setup?.(target);
  const savedEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const initial = createInitialState({
      targetDir: target,
      harness: 'opencode',
      config: {},
      overwrite: {},
            personalRules: '',
      skillConflicts: ['wayfinder'],
      vscodeKept: false,
    });
    initial.discovery = { status: 'ready', models, detail: '' };
    const rendered = renderTree(React.createElement(InstallerApp, {
      initial,
      onDone: () => {},
      onInstall: onInstall ?? (async () => {
        throw new Error('evidence stub: no install expected');
      }),
    }), size);
    live.push(rendered);
    await rendered.ready();
    await drive(rendered);
    const raw = rendered.frame();
    const stripped = stripAnsi(raw);
    const { writeFileSync: write, mkdirSync: mkdir } = await import('node:fs');
    mkdir(EVIDENCE_DIR, { recursive: true });
    write(join(EVIDENCE_DIR, `${name}.txt`), `size=${size.columns}x${size.rows}\n${stripped}\n`);
    write(join(EVIDENCE_DIR, `${name}.raw.txt`), raw);
    // Viewport budget: every rendered frame fits its terminal exactly —
    // nothing scrolls away the header, focus, actions or footer on real PTYs.
    const frameLines = stripped.split('\n');
    while (frameLines.length > 0 && frameLines[frameLines.length - 1]?.trim() === '') frameLines.pop();
    const lines = frameLines.length;
    let widest = 0;
    for (const line of frameLines) {
      widest = Math.max(widest, stringWidth(line));
    }
    // Unmount now so the matrix never holds more than one live app (and its
    // process signal handlers) at a time; afterEach remains the backstop.
    rendered.stop();
    const liveIndex = live.indexOf(rendered);
    if (liveIndex >= 0) live.splice(liveIndex, 1);
    expect(lines, `${name} fits ${size.rows} rows`).toBeLessThanOrEqual(size.rows);
    expect(widest, `${name} fits ${size.columns} columns`).toBeLessThanOrEqual(size.columns);
    return { stripped, raw };
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('rendered evidence matrix', () => {
  it.each([1, 2, 3])('renders the middle focused action within a %i-row menu budget', async (budget) => {
    const rendered = renderTree(<MenuList items={[
      { id: 'before', label: 'Before' },
      { id: 'focus', label: `Install into /${'long-path/'.repeat(20)}` },
      { id: 'after', label: 'After' },
    ]} focusedId="focus" viewportHeight={budget} width={40} compact hintMode="none" />, { columns: 40, rows: 8 });
    live.push(rendered);
    await rendered.ready();
    const frame = stripAnsi(rendered.frame());
    expect(frame).toMatch(/>\s+Install into/);
    expect(frame.trimEnd().split('\n').length).toBeLessThanOrEqual(budget);
    for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(40);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, `menu-middle-${budget}.txt`), frame);
  });
  it.each([[99, 24], [40, 8], [99, 45], [100, 39]])('U09-1: suppressed UX warning is visibly inspectable at %ix%i without mutating actions', async (columns, rows) => {
    const root = workspace();
    const target = join(root, 'notice-path-start', ...Array(25).fill('temp-root-segment'), 'notice-target-end');
    mkdirSync(target, { recursive: true });
    const initial = createInitialState({ targetDir: target, harness: 'opencode', config: {}, overwrite: {}, personalRules: '', skillConflicts: [], vscodeKept: true });
    initial.discovery = { status: 'ready', models: [], detail: '' };
    let result: AppResult | null = null;
    const rendered = renderTree(<InstallerApp initial={initial} onDone={(value) => { result = value; }} />, { columns, rows });
    live.push(rendered);
    await rendered.ready();
    // The short quit action is deliberately not a capped label: a notice
    // must remain inspectable independently of focused-label truncation.
    await rendered.send(KEYS.end);
    const before = stripAnsi(rendered.frame());
    const content = (frame: string) => frame.split('\n').map((line) => columns >= 100 ? [...line].slice(44).join('') : line).join('\n').replace(/\s+/g, ' ');
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const save = (name: string) => {
      const text = stripAnsi(rendered.frame());
      writeFileSync(join(EVIDENCE_DIR, `notice-${columns}x${rows}-${name}.txt`), text);
      const lines = text.trimEnd().split('\n');
      expect(lines.length).toBeLessThanOrEqual(rows);
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(columns);
      return text;
    };
    save('action');
    expect(before).toMatch(/>\s+Quit without writing/);
    if (content(before).includes('No recommended Sol model is available for UX')) {
      expect(content(before)).toContain('No recommended Sol model is available for UX');
      expect(content(before)).toContain('explicitly before running design work.');
      expect(stripAnsi(await rendered.send(KEYS.space))).toBe(before);
    } else {
      expect(before).not.toContain('No recommended Sol model');
      expect(before).toContain('Space warning/details');
      await rendered.send(KEYS.space);
      let inspected = content(save('detail'));
      for (let page = 0; page < 20; page += 1) {
        inspected += '\n' + content(stripAnsi(await rendered.send(KEYS.pageDown)));
        save(`page-${page}`);
      }
      expect(inspected.replace(/\s+/g, ' ')).toContain('No recommended Sol model is available for UX');
      expect(inspected.replace(/\s+/g, ' ')).toContain('explicitly before running design work.');
      // Esc remains the global safe quit dialog; continuing restores the
      // exact pager viewport, then closing restores the focused action.
      const paged = stripAnsi(rendered.frame());
      expect(stripAnsi(await rendered.send(KEYS.esc))).toContain('Quit setup?');
      expect(stripAnsi(await rendered.send(KEYS.enter))).toBe(paged);
      expect(stripAnsi(await rendered.send(KEYS.space))).toBe(before);
      await rendered.send(KEYS.home);
      if (rows === 8) await rendered.send(KEYS.down); // skip inspection-only target row
      for (const label of ['Choose another target folder', 'Install into this directory']) {
        const action = save(label.startsWith('Choose') ? 'choose' : 'confirm');
        expect(action).toContain('Space warning/details');
        // Full-size confirmation labels include the target rather than the
        // minimum band's short label; both retain the action's identity.
        expect(action.replace(/\s+/g, ' ')).toContain(label.startsWith('Choose') ? label : 'Install into');
        if (rows === 8) expect(action).toContain(label);
        await rendered.send(KEYS.space);
        expect(stripAnsi(rendered.frame())).toContain(label.startsWith('Choose') ? 'Choose another target folder' : 'Install into');
        await rendered.send(KEYS.end);
        expect(save(label.startsWith('Choose') ? 'choose-warning-end' : 'confirm-warning-end').replace(/\s+/g, ' ')).toContain('design work.');
        expect(stripAnsi(await rendered.send(KEYS.space))).toBe(action);
        await rendered.send(KEYS.down);
      }
      expect(stripAnsi(rendered.frame())).toBe(before);
    }
    await rendered.send(KEYS.ctrlC);
    await rendered.send('q');
    expect(result).not.toBeNull();
    const finalState = (result as AppResult | null)?.state;
    expect(finalState?.targetDir).toBe(target);
    expect(finalState?.config).toEqual(initial.config);
    expect(finalState?.focusId).toBe('quit');
    expect(finalState?.installRequested).toBe(false);
    expect(finalState?.notice).toBe('No recommended Sol model is available for UX. An unset UX model inherits the current model; select a suitable model explicitly before running design work.');
    expect(existsSync(join(target, '.opencode'))).toBe(false);
  });

  const sizes = [
      ['120x45', { columns: 120, rows: 45 }],
      ['100x39', { columns: 100, rows: 39 }],
      ['99x24', { columns: 99, rows: 24 }],
      ['60x12', { columns: 60, rows: 12 }],
      ['59x12', { columns: 59, rows: 12 }],
      ['80x11', { columns: 80, rows: 11 }],
      ['40x8', { columns: 40, rows: 8 }],
      ['30x20-belowmin', { columns: 30, rows: 20 }],
    ] as const;
  it.each(sizes)('captures all required sizes, modes and states: directory %s', async (label, size) => {
      const { stripped } = await capture(`directory-${label}`, size, async () => {});
      if (label === '30x20-belowmin') expect(stripped).toContain('Terminal too small');
      else expect(stripped).toContain('Step 1 of 4');
  });

  it('captures all required sizes, modes and states: interaction and color modes', async () => {
    // Truecolor avatar at full size (forced chalk level for headless capture).
    const color = await capture('directory-120x45-truecolor', { columns: 120, rows: 45 }, async () => {}, undefined, {
      FORCE_COLOR: '3',
      COLORTERM: 'truecolor',
    });
    expect(color.stripped).toContain('Step 1 of 4');

    // Monochrome avatar under NO_COLOR.
    const mono = await capture('directory-120x45-nocolor', { columns: 120, rows: 45 }, async () => {}, undefined, {
      NO_COLOR: '1',
      FORCE_COLOR: undefined,
      COLORTERM: undefined,
    });
    expect(mono.stripped).toContain('Step 1 of 4');

    // Long model IDs: truncation with focused full detail.
    const longIds = await capture(
      'agents-long-ids-100x39',
      { columns: 100, rows: 39 },
      async (rendered) => {
        await rendered.send(KEYS.enter);
        for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
        await rendered.send(KEYS.enter);
        await rendered.send(KEYS.down);
      },
      (target) => {
        writeFileSync(join(target, 'a-very-long-rules-filename-that-keeps-going-and-going-0123456789.md'), 'x');
      },
    );
    expect(longIds.stripped).toContain('…');

    // Empty catalog with unmatched search.
    const empty = await capture(
      'agents-empty-catalog-99x24',
      { columns: 99, rows: 24 },
      async (rendered) => {
        await rendered.send(KEYS.enter);
        for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
        await rendered.send(KEYS.enter);
        await rendered.send(KEYS.tab);
        await rendered.send('zzz-no-such-model');
      },
      undefined,
      undefined,
      [],
    );
    expect(empty.stripped).toContain('Empty catalog');
    expect(empty.stripped).toContain('Use "zzz-no-such-model"');

    // Rules browser with long paths plus a loader error, staying recoverable.
    const browser = await capture(
      'instructions-browser-99x24',
      { columns: 99, rows: 24 },
      async (rendered) => {
        await rendered.send(KEYS.enter);
        await rendered.send(KEYS.end);
        await rendered.send(KEYS.enter);
        await rendered.send(KEYS.enter); // Browse is now the first instructions row
        await rendered.send(KEYS.down);
        await rendered.send(KEYS.down);
        await rendered.send(KEYS.enter);
      },
      (target) => {
        writeFileSync(join(target, 'bad.md'), '<!-- spec-driven-scrum-team:toady:end -->');
        writeFileSync(join(target, 'a-very-long-rules-filename-that-keeps-going-and-going-0123456789.md'), 'Good.');
      },
    );
    expect(browser.stripped).toContain('Directory:');

    // Quit dialog opened from a text draft: the draft survives the dialog.
    const draft = await capture(
      'quit-dialog-draft-99x24',
      { columns: 99, rows: 24 },
      async (rendered) => {
        await rendered.send(KEYS.enter);
        for (let i = 0; i < 5; i += 1) await rendered.send(KEYS.down);
        await rendered.send(KEYS.enter);
        for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
        await rendered.send(KEYS.enter);
        await rendered.send('half-typed-id');
        await rendered.send(KEYS.esc);
      },
    );
    expect(draft.stripped).toContain('Quit setup?');

    // Hold completion explicitly; a quiet frame is not a completed install.
    let finishInstall!: () => void;
    const pendingInstall = new Promise<void>((resolve) => { finishInstall = resolve; });
    const progress = await capture(
      'install-progress-99x24',
      { columns: 99, rows: 24 },
      async (rendered) => {
        await rendered.send(KEYS.enter);
        await rendered.send(KEYS.end);
        await rendered.send(KEYS.enter);
        for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
        await rendered.send(KEYS.enter);
        // Adopt the conflicting skill, then install: progress shows in-shell.
        await rendered.send(KEYS.up);
        await rendered.send(KEYS.space);
        await rendered.send(KEYS.down);
        await rendered.send(KEYS.enter);
        await rendered.waitFor(() => stripAnsi(rendered.frame()).includes('Writing team files…'), 'install progress');
      },
      undefined,
      undefined,
      undefined,
      async (state) => {
        await pendingInstall;
        return {
          target: state.targetDir,
          team: { removed: [], legacyPreserved: [], written: [], preserved: [], configPath: '', gitignorePath: '', skillPath: '', skillPaths: [] },
          instructionsPaths: [],
          vscode: { path: '', status: 'kept' },
        };
      },
    );
    finishInstall();
    expect(progress.stripped).toContain('Writing team files…');

    // Review at full and compact sizes: actions stay reachable via windowing.
    for (const [label, size] of [['review-120x45', { columns: 120, rows: 45 }], ['review-60x12', { columns: 60, rows: 12 }]] as const) {
      const review = await capture(
        label,
        size,
        async (rendered) => {
          await rendered.send(KEYS.enter);
          await rendered.send(KEYS.end);
          await rendered.send(KEYS.enter);
          for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
          await rendered.send(KEYS.enter);
          await rendered.send(KEYS.end);
        },
      );
      expect(review.stripped).toContain('Step 4 of 4');
      expect(review.stripped).toContain('Install — apply this configuration');
    }
    expect(existsSync(EVIDENCE_DIR)).toBe(true);
  }, 120000);

  it('long absolute target fits 99x24 with full path, focused confirmation and exact install target', async () => {
    const root = workspace();
    const target = join(root, 'long-target-start-sentinel', 'parent-segment-that-exceeds-the-summary-width'.repeat(2), 'long-target-end-sentinel');
    mkdirSync(target, { recursive: true });
    const initial = createInitialState({ targetDir: target, harness: 'opencode', config: {}, overwrite: {}, personalRules: '', skillConflicts: [], vscodeKept: true });
    initial.discovery = { status: 'ready', models: [], detail: '' };
    let installedTarget: string | null = null;
    const rendered = renderTree(React.createElement(InstallerApp, {
      initial,
      onDone: () => {},
      onInstall: async (state) => {
        installedTarget = state.targetDir;
        return fakeInstallResult(state.targetDir);
      },
    }), { columns: 99, rows: 24 });
    live.push(rendered);
    await rendered.ready();
    const text = stripAnsi(rendered.frame());
    const lines = text.trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(24);
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(99);
    expect(text).toContain('Step 1 of 4');
    expect(text).toContain('Enter activate');
    expect(text).toMatch(/>\s+Install into/);
    expect(text).toContain('Target (defaults');
    expect(installedTarget).toBeNull();
    expect(existsSync(join(target, '.opencode'))).toBe(false);
    let frame = await rendered.send(KEYS.space);
    expect(stripAnsi(frame)).not.toBe(text);
    expect(stripAnsi(frame)).toContain('Install into');
    const label = `Install into ${target}`;
    let read = '';
    for (let page = 0; page < 128; page++) {
      const details = stripAnsi(frame).trimEnd().split('\n');
      expect(details.length).toBeLessThanOrEqual(24);
      for (const line of details) expect(stringWidth(line)).toBeLessThanOrEqual(99);
      for (const line of details.map(row => row.trim().replace(/^>\s*/, ''))) {
        const remaining = label.slice(read.length);
        const continuation = remaining.trimStart();
        if (line && continuation.startsWith(line)) read += remaining.slice(0, remaining.length - continuation.length) + line;
      }
      if (read === label) break;
      frame = await rendered.send(KEYS.down);
    }
    expect(read, 'all full path components in visible details').toBe(label);
    await rendered.send(KEYS.space);
    expect(stripAnsi(rendered.frame())).toBe(text);
    expect(installedTarget).toBeNull();
    await rendered.send(KEYS.enter);
    expect(stripAnsi(rendered.frame())).toContain('Step 2 of 4');
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter);
    for (let i = 0; i < 3; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.enter);
    await rendered.waitFor(() => installedTarget !== null, 'exact long target passed to install');
    expect(installedTarget).toBe(target);
    expect(existsSync(join(target, '.opencode'))).toBe(false);
  });
});
