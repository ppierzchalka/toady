import React, { useEffect } from 'react';
import { EventEmitter } from 'node:events';
import { render, useInput, type Instance } from 'ink';
import type { ReactElement } from 'react';
import { join } from 'node:path';

export class FakeStdout extends EventEmitter {
  columns: number;
  rows: number;
  frames: string[] = [];
  isTTY = true;
  constructor(columns = 100, rows = 30) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
  write = (frame: string | Uint8Array, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    const content = typeof frame === 'string' ? frame : Buffer.from(frame).toString();
    // Ink uses an empty write with a callback as its public flush barrier.
    if (content !== '') this.frames.push(content);
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    done?.(null);
    return true;
  };
  lastFrame = (): string => this.frames[this.frames.length - 1] ?? '';
}

export class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  private buffer: string | null = null;
  setEncoding(): void {}
  setRawMode(enabled: boolean): void { this.isRaw = enabled; }
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  write = (data: string): void => {
    this.buffer = this.buffer === null ? data : this.buffer + data;
    this.emit('readable');
    this.emit('data', data);
  };
  read = (): string | null => {
    const data = this.buffer;
    this.buffer = null;
    return data;
  };
}

export interface Rendered {
  app: Instance;
  stdout: FakeStdout;
  stdin: FakeStdin;
  frame: () => string;
  ready: () => Promise<string>;
  settle: () => Promise<string>;
  waitFor: (predicate: () => boolean, label: string) => Promise<string>;
  send: (data: string) => Promise<string>;
  resize: (columns: number, rows: number) => Promise<string>;
  stop: () => void;
}

const yieldLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export function renderTree(tree: ReactElement, options: { columns?: number; rows?: number; timeoutMs?: number } = {}): Rendered {
  const stdout = new FakeStdout(options.columns ?? 100, options.rows ?? 30);
  const stdin = new FakeStdin();
  const stderr = new FakeStdout(options.columns ?? 100, options.rows ?? 30);
  let mounted = false;
  let wasMounted = false;
  let stopped = false;
  let inputRevision = 0;
  let renderRevision = 0;
  let lastInput = '';
  const cancellations = new Set<() => void>();
  function Probe(): null {
    useInput((input, key) => {
      inputRevision += 1;
      lastInput = JSON.stringify({ input, key });
    });
    useEffect(() => {
      mounted = true;
      wasMounted = true;
      return () => { mounted = false; };
    }, []);
    return null;
  }
  const app = render(<>{tree}<Probe /></>, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
    // Forced: intermediate frames and input must work under CI detection too.
    interactive: true,
    alternateScreen: true,
    onRender: () => { renderRevision += 1; },
  });
  const lastContent = (): string => {
    for (let index = stdout.frames.length - 1; index >= 0; index -= 1) {
      if (stripAnsi(stdout.frames[index]).trim() !== '') return stdout.frames[index];
    }
    return '';
  };
  // Quiet rendering is only a render/effect barrier, never business completion.
  // Every operation owns ONE deadline, including readiness, input parsing and flush.
  const observe = async (predicate: () => boolean, label: string): Promise<string> => {
    const diagnostic = () => `${label}: mounted=${mounted}, stopped=${stopped}, inputRevision=${inputRevision}, renderRevision=${renderRevision}, lastInput=${lastInput}\nLast frame:\n${stripAnsi(lastContent())}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${options.timeoutMs ?? 2000}ms waiting for ${diagnostic()}`)), options.timeoutMs ?? 2000);
      cancel = () => reject(new Error(`Stopped while waiting for ${diagnostic()}`));
      cancellations.add(cancel);
    });
    try {
      let previous = '';
      let stable = 0;
      while (true) {
        if (stopped) throw new Error(`Stopped while waiting for ${diagnostic()}`);
        await Promise.race([yieldLoop(), deadline]);
        await Promise.race([app.waitUntilRenderFlush(), deadline]);
        const revision = `${inputRevision}:${renderRevision}`;
        // App-controlled exit unmounts the probe too. An acknowledged final
        // key and explicit result predicate must still settle after that exit.
        stable = wasMounted && predicate() && revision === previous ? stable + 1 : 0;
        if (stable >= 3) return lastContent();
        previous = revision;
      }
    } finally {
      clearTimeout(timer);
      cancellations.delete(cancel);
    }
  };
  let queued: Promise<unknown> = Promise.resolve();
  const sequential = (operation: () => Promise<string>): Promise<string> => {
    const result = queued.then(operation);
    queued = result.catch(() => {});
    return result;
  };
  return {
    app,
    stdout,
    stdin,
    frame: lastContent,
    ready: () => observe(() => mounted, 'mount readiness'),
    settle: () => observe(() => true, 'render/effect settlement'),
    waitFor: observe,
    send: (data: string) => sequential(async () => {
      // Readiness and input share the same deadline; no key batching, including Esc.
      let sent = false;
      let before = inputRevision;
      return observe(() => {
        if (!sent && mounted) {
          before = inputRevision;
          sent = true;
          stdin.write(data);
          return false;
        }
        return sent && inputRevision > before;
      }, `parsed input ${JSON.stringify(data)}`);
    }),
    resize: (columns: number, rows: number) => sequential(async () => {
      stdout.columns = columns;
      stdout.rows = rows;
      stdout.emit('resize');
      return observe(() => mounted, `resize ${columns}x${rows}`);
    }),
    stop: () => {
      if (stopped) return;
      stopped = true;
      for (const cancel of cancellations) cancel();
      try {
        app.unmount();
      } catch {
        // Best-effort teardown in tests.
      }
      app.cleanup();
    },
  };
}

export const stripAnsi = (frame: string): string =>
  // eslint-disable-next-line no-control-regex
  frame.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Z]/g, '').replace(/\x1b[>=]/g, '');

export const KEYS = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  enter: '\r',
  esc: '\x1b',
  tab: '\t',
  shiftTab: '\x1b[Z',
  space: ' ',
  ctrlC: '\x03',
  backspace: '\x7f',
} as const;

export interface FakeInstallResult {
  target: string;
  team: {
    removed: string[];
    legacyPreserved: string[];
    written: string[];
    preserved: string[];
    configPath: string;
    gitignorePath: string;
    skillPath: string;
    skillPaths: string[];
  };
  instructionsPaths: string[];
  vscode: { path: string; status: 'wrote' | 'kept' };
}

export function fakeInstallResult(target: string): FakeInstallResult {
  return {
    target,
    team: { removed: [], legacyPreserved: [], written: [], preserved: [], configPath: join(target, 'team.config.json'), gitignorePath: join(target, '.gitignore'), skillPath: '', skillPaths: [] },
    instructionsPaths: [],
    vscode: { path: join(target, '.vscode/settings.json'), status: 'kept' },
  };
}
