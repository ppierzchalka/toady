import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import stringWidth from 'string-width';
import type { InstallAllResult } from '../installer/installAll.js';
import { InstallerApp } from './app.js';
import { createInitialState, type SessionState } from './state.js';
import { KEYS, renderTree, stripAnsi, type Rendered } from './testSupport.js';

const roots: string[] = [];
const live: Rendered[] = [];
afterEach(() => {
  while (live.length) live.pop()?.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'tui-stress-'));
  roots.push(root);
  return root;
}

async function mountAt(target: string, columns: number, rows: number, mutate: (initial: ReturnType<typeof createInitialState>) => void = () => {}, onInstall?: (state: SessionState) => Promise<InstallAllResult>) {
  const initial = createInitialState({
    targetDir: target,
    harness: 'opencode',
    config: {},
    overwrite: {},
        personalRules: 'Prior rules.',
    skillConflicts: [],
    vscodeKept: false,
  });
  initial.discovery = { status: 'ready', models: ['opencode/alpha'], detail: '' };
  mutate(initial);
  const rendered = renderTree(React.createElement(InstallerApp, {
    initial,
    onDone: () => {},
    onInstall: onInstall ?? (async () => { throw new Error('no install in stress'); }),
  }), { columns, rows });
  live.push(rendered);
  await rendered.ready();
  return rendered;
}

function expectFit(name: string, frame: string, columns: number, rows: number): void {
  const lines = stripAnsi(frame).split('\n');
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  expect(lines.length, `${name} fits ${rows} rows`).toBeLessThanOrEqual(rows);
  for (const line of lines) {
    expect(stringWidth(line), `${name} fits ${columns} columns`).toBeLessThanOrEqual(columns);
  }
}

describe('40x8 stress viewports', () => {
  it('keeps the picker error readable and actionable at 40x8', async () => {
    const target = workspace();
    writeFileSync(join(target, 'bad.md'), '<!-- spec-driven-scrum-team:toady:end -->');
    const rendered = await mountAt(target, 40, 8, (initial) => {
      initial.step = 'instructions';
      initial.rulesBrowser.open = true;
      initial.focusId = join(target, 'bad.md');
    });
    await rendered.send(KEYS.enter); // select bad.md → loader error, browser stays open
    const frame = rendered.frame();
    expect(stripAnsi(frame)).toContain('managed block markers');
    expectFit('browser-error-40x8', frame, 40, 8);
    // Cancel stays keyboard-reachable with prior rules intact: End lands on
    // Cancel, Enter closes, and Enter reopens the browser from its row.
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter);
    expect(stripAnsi(rendered.frame())).not.toContain('Directory:');
    await rendered.send(KEYS.enter); // focus restored to rules-browse → reopen
    expect(stripAnsi(rendered.frame())).toContain('Directory:');
  });

  it('keeps direct-path failures usable at 40x8', async () => {
    const target = workspace();
    const rendered = await mountAt(target, 40, 8, (initial) => {
      initial.step = 'instructions';
      initial.focusId = 'rules-path';
    });
    await rendered.send(KEYS.enter); // open path draft
    await rendered.send(`missing-${'x'.repeat(80)}.md`);
    await rendered.send(KEYS.enter); // commit → loader error, editing stays
    const frame = rendered.frame();
    expect(stripAnsi(frame)).toContain('ENOENT');
    expectFit('rules-path-error-40x8', frame, 40, 8);
  });

  it('keeps a 207-character model committable at 40x8', async () => {
    const target = workspace();
    const long = `openai/${'very-long-'.repeat(20)}`;
    const rendered = await mountAt(target, 40, 8, (initial) => {
      initial.step = 'agents';
      initial.agentDetail = 'analyst';
      initial.discovery.models = [long];
      initial.focusId = `value:${long}`;
    });
    const frame = rendered.frame();
    expectFit('very-long-model-40x8', frame, 40, 8);
    // Full value reachable: Enter commits the focused long model.
    await rendered.send(KEYS.enter);
    await rendered.send(KEYS.esc); // back to role list
    expect(stripAnsi(rendered.frame())).toContain('analyst');
  });

  it('confirms a long invocation directory at 40x8', async () => {
    const target = workspace();
    const nested = join(target, ...Array.from({ length: 6 }, () => 'nested-long-directory-name'));
    mkdirSync(nested, { recursive: true });
    const rendered = await mountAt(nested, 40, 8);
    const frame = rendered.frame();
    // The full path stays keyboard-accessible (scrollable), actions visible.
    expect(stripAnsi(frame)).toContain('Install into');
    expectFit('long-target-40x8', frame, 40, 8);
  });

  it('keeps long search queries committable at 40x8', async () => {
    const target = workspace();
    const seenBox: { state: SessionState | null } = { state: null };
    const query = `custom/${'query-long-'.repeat(8)}`;
    const rendered = await mountAt(target, 40, 8, (initial) => {
      initial.step = 'agents';
      initial.agentDetail = 'analyst';
    }, async (state) => {
      seenBox.state = state;
      return {
        target,
        team: { removed: [], legacyPreserved: [], written: [], preserved: [], configPath: '', gitignorePath: '', skillPath: '', skillPaths: [] },
        instructionsPaths: [],
        vscode: { path: '', status: 'kept' },
      };
    });
    // Search region is entered with Tab; the long query wraps the input line.
    await rendered.send(KEYS.tab);
    await rendered.send(query);
    expectFit('long-search-40x8', rendered.frame(), 40, 8);
    await rendered.send(KEYS.enter); // commits the exact typed custom query
    await rendered.send(KEYS.esc); // clear search, back to list region
    await rendered.send(KEYS.esc); // back to the role list
    await rendered.send(KEYS.end);
    await rendered.send(KEYS.enter); // persona
    for (let i = 0; i < 4; i += 1) await rendered.send(KEYS.down);
    await rendered.send(KEYS.enter); // review
    await rendered.send(KEYS.enter); // install
    await rendered.waitFor(() => seenBox.state !== null, 'writer received committed model');
    // The exact long query survives to the writer — never truncated, never cleared.
    expect(seenBox.state?.config.analyst?.model).toBe(query);
  });
});
