import { describe, it, expect } from 'vitest';
import { runInstallerApp } from './run.js';
import { createInitialState } from './state.js';
import { FakeStdin, FakeStdout, stripAnsi } from './testSupport.js';

// This test exercises the real runner, not renderTree's probe. Observe its
// public terminal state and frame, with one deadline per expected transition.
async function waitFor(predicate: () => boolean, label: string, stdout: FakeStdout): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}\nLast frame:\n${stripAnsi(stdout.lastFrame())}`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('installer lifecycle', () => {
  it('restores the terminal (exits the alternate screen) on dialog quit and leaks no signal handlers', async () => {
    const quitOnce = async () => {
      const stdin = new FakeStdin();
      const stdout = new FakeStdout(100, 30);
      const stderr = new FakeStdout(100, 30);
      const initial = createInitialState({
        targetDir: '/repo',
        harness: 'opencode',
        config: {},
        overwrite: {},
                personalRules: '',
        skillConflicts: [],
        vscodeKept: true,
      });
      initial.discovery = { status: 'ready', models: [], detail: '' };
      const pending = runInstallerApp({
        initial,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        stderr: stderr as unknown as NodeJS.WriteStream,
        patchConsole: false,
      });
      await waitFor(() => stdin.isRaw && stdin.listenerCount('readable') > 0 && stdout.frames.some((frame) => stripAnsi(frame).includes('Install into')), 'runner input readiness', stdout);
      stdin.write('\x1b');
      await waitFor(() => stdout.frames.some((frame) => stripAnsi(frame).includes('Quit setup?')), 'parsed Esc quit dialog', stdout);
      stdin.write('Q');
      let completed = false;
      void pending.then(() => { completed = true; });
      await waitFor(() => completed, 'runner quit completion', stdout);
      const result = await pending;
      expect(result.type).toBe('quit');
      return stdout.frames.join('');
    };
    const first = await quitOnce();
    expect(first).toContain('[?1049h');
    expect(first).toContain('[?1049l');
    // Process-global handlers belong to Ink's runtime; per-run handlers must
    // not accumulate.
    const settled = process.listenerCount('SIGTERM');
    const settledInt = process.listenerCount('SIGINT');
    await quitOnce();
    expect(process.listenerCount('SIGTERM')).toBe(settled);
    expect(process.listenerCount('SIGINT')).toBe(settledInt);
  });

  it('refuses to mount without a real terminal before any writes', async () => {
    const stdin = new FakeStdin();
    stdin.isTTY = false;
    const stdout = new FakeStdout(100, 30);
    const initial = createInitialState({
      targetDir: '/repo',
      harness: 'opencode',
      config: {},
      overwrite: {},
            personalRules: '',
      skillConflicts: [],
      vscodeKept: true,
    });
    await expect(
      runInstallerApp({
        initial,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
      }),
    ).rejects.toThrow(/not a TTY/);
  });

  it('refuses startup below the minimum viewport before entering the alternate screen', async () => {    const stdin = new FakeStdin();
    const stdout = new FakeStdout(30, 20);
    const initial = createInitialState({
      targetDir: '/repo',
      harness: 'opencode',
      config: {},
      overwrite: {},
            personalRules: '',
      skillConflicts: [],
      vscodeKept: true,
    });
    await expect(
      runInstallerApp({
        initial,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
      }),
    ).rejects.toThrow(/Terminal too small/);
    // The screen was never taken over and nothing could be written.
    expect(stdout.frames.join('')).not.toContain('[?1049h');
  });

  it('registers persistent signal handlers and removes them exactly once per mount', async () => {
    const { renderTree } = await import('./testSupport.js');
    const { InstallerApp } = await import('./app.js');
    const React = await import('react');
    // Ink installs process-lifetime signal handlers (signal-exit) on its first
    // render and never removes them. Absorb that one-time installation with a
    // warm-up mount/unmount so the assertions below measure only this app's
    // per-mount handlers, independent of test order.
    {
      const warmStdout = new FakeStdout(100, 30);
      const warmInitial = createInitialState({
        targetDir: '/repo',
        harness: 'opencode',
        config: {},
        overwrite: {},
                personalRules: '',
        skillConflicts: [],
        vscodeKept: true,
      });
      warmInitial.discovery = { status: 'ready', models: [], detail: '' };
      const warm = renderTree(
        React.createElement(InstallerApp, { initial: warmInitial, onDone: () => {}, onInstall: async () => { throw new Error('no install'); } }),
        { columns: 100, rows: 30 },
      );
      await warm.ready();
      const warmMounted = process.listenerCount('SIGTERM');
      warm.stop();
      // Wait until the warm-up app's own handler is removed, leaving only
      // Ink's process-lifetime handlers as the stable baseline.
      await waitFor(() => process.listenerCount('SIGTERM') < warmMounted, 'warm-up teardown', warmStdout);
    }
    const beforeInt = process.listenerCount('SIGINT');
    const beforeTerm = process.listenerCount('SIGTERM');
    for (let i = 0; i < 3; i += 1) {
      const stdin = new FakeStdin();
      const stdout = new FakeStdout(100, 30);
      const initial = createInitialState({
        targetDir: '/repo',
        harness: 'opencode',
        config: {},
        overwrite: {},
                personalRules: '',
        skillConflicts: [],
        vscodeKept: true,
      });
      initial.discovery = { status: 'ready', models: [], detail: '' };
      let done: unknown = null;
      const rendered = renderTree(
        React.createElement(InstallerApp, {
          initial,
          onDone: (result: unknown) => {
            done = result;
          },
          onInstall: async () => {
            throw new Error('no install');
          },
        }),
        { columns: 100, rows: 30 },
      );
      await rendered.ready();
      // Persistent handlers: still registered after mounting (not one-shot).
      expect(process.listenerCount('SIGTERM')).toBeGreaterThan(beforeTerm);
      rendered.stop();
      await waitFor(() => process.listenerCount('SIGTERM') === beforeTerm && process.listenerCount('SIGINT') === beforeInt, 'signal teardown', stdout);
      void done;
    }
    // Unmount cleanup removes them again: no accumulation across mounts.
    expect(process.listenerCount('SIGINT')).toBe(beforeInt);
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm);
  });
});
