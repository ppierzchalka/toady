import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planJev, writeJevSettings } from './jev.js';

const runner = fileURLToPath(new URL('../../skills/decision-gates/scripts/judge.mjs', import.meta.url));
let root: string;
let personal: string;
let work: string;
let xdg: string;
let mockModule: string;
let prior: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'toady-gates-runtime-'));
  personal = join(root, 'private');
  work = join(root, 'corporate');
  xdg = join(root, 'user-config');
  mkdirSync(personal);
  mkdirSync(work);
  prior = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  mockModule = join(root, 'mock-fetch.mjs');
  writeFileSync(mockModule, String.raw