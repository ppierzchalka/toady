import { describe, it, expect } from 'vitest';
import { migratePlannerConfig, resolveDefault, seedDefaults, resetAgent, resetAllToDefaults } from './defaults.js';
import type { TeamConfig } from '../types.js';

const AVAILABLE = [
  'openai/gpt-6.1-sol',
  'openai/gpt-6-sol',
  'openai/gpt-6-luna',
  'openai/gpt-5.6-luna',
  'openai/gpt-5.6-terra',
  'openai/gpt-6-astra',
  'opencode-go/gemini-4-argon-contributor',
  'opencode/gemini-4-argon',
  'opencode-go/deepseek-v4-pro',
  'opencode/deepseek-v4-pro',
  'opencode-go/deepseek-v4-flash',
  'opencode-go/qwen3.8-flash',
  'opencode-go/qwen3.8-max',
];

describe('resolveDefault', () => {
  it('allocates the exact preferred models and reasoning efforts when available', () => {
    expect(resolveDefault('analyst', AVAILABLE)).toEqual({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' });
    expect(resolveDefault('lead', AVAILABLE)).toEqual({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' });
    expect(resolveDefault('architect', AVAILABLE)).toEqual({ model: 'openai/gpt-6-luna', reasoningEffort: 'high' });
    expect(resolveDefault('security', AVAILABLE)).toEqual({ model: 'openai/gpt-6-luna', reasoningEffort: 'high' });
    expect(resolveDefault('ux', AVAILABLE)).toEqual({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' });
    expect(resolveDefault('tester', AVAILABLE)).toEqual({ model: 'opencode-go/gemini-4-argon-contributor', reasoningEffort: 'medium' });
    expect(resolveDefault('developer', AVAILABLE)).toEqual({ model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'medium' });
    expect(resolveDefault('reviewer', AVAILABLE)).toEqual({ model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'high' });
  });

  it('returns undefined (inherit) when the exact primary default model is unavailable', () => {
    expect(resolveDefault('analyst', ['openai/gpt-6-sol', 'openai/gpt-5.6-terra'])).toBeUndefined();
    expect(resolveDefault('lead', ['openai/gpt-6-sol', 'openai/gpt-5.6-terra'])).toBeUndefined();
    expect(resolveDefault('architect', ['openai/gpt-5.6-luna'])).toBeUndefined();
    expect(resolveDefault('security', ['opencode-go/deepseek-v4-pro', 'opencode/deepseek-v4-pro'])).toBeUndefined();
    expect(resolveDefault('ux', ['openai/gpt-6-sol'])).toBeUndefined();
    expect(resolveDefault('tester', ['opencode/gemini-4-argon', 'opencode-go/muse-spark-1.3-contributor'])).toBeUndefined();
    expect(resolveDefault('developer', ['opencode/deepseek-v4-pro'])).toBeUndefined();
    expect(resolveDefault('reviewer', ['opencode/deepseek-v4-pro', 'opencode-go/deepseek-v4-flash'])).toBeUndefined();
  });

  it('inherits for every role in work mode when only Vertex models are available', () => {
    const vertexOnly = ['google-vertex/gemini-2.5-pro', 'google-vertex/gemini-2.5-flash', 'google-vertex/claude-sonnet-4-5'];
    for (const name of ['analyst', 'lead', 'architect', 'security', 'ux', 'tester', 'developer', 'reviewer']) {
      expect(resolveDefault(name, vertexOnly)).toBeUndefined();
    }
    expect(seedDefaults({}, vertexOnly)).toEqual({});
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveDefault('developer', [])).toBeUndefined();
    expect(resolveDefault('reviewer', ['opencode-go/qwen3.8-flash'])).toBeUndefined();
  });

  it('never picks a variant or different provider by accident of prefix', () => {
    expect(resolveDefault('architect', ['opencode-go/gpt-6-luna'])).toBeUndefined();
    expect(resolveDefault('architect', ['openai/gpt-6.1-sol-fast'])).toBeUndefined();
    expect(resolveDefault('tester', ['opencode-go/gemini-4-argon-contributor-fast'])).toBeUndefined();
  });

  it('never defaults any role to Astra', () => {
    for (const name of ['analyst', 'lead', 'architect', 'security', 'ux', 'tester', 'developer', 'reviewer']) {
      expect(resolveDefault(name, ['openai/gpt-6-astra', 'opencode/gpt-6-astra'])).toBeUndefined();
    }
  });
});

describe('seedDefaults', () => {
  it('fills every agent with a default when there is no saved config', () => {
    const seeded = seedDefaults({}, AVAILABLE);
    for (const name of ['analyst', 'lead', 'architect', 'security', 'ux', 'tester', 'developer', 'reviewer']) {
      expect(seeded[name]?.model).toBeTruthy();
    }
    expect(seeded.lead).toEqual({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' });
  });

  it('keeps persisted choices and only fills in agents that are unset', () => {
    const seeded = seedDefaults({ lead: { model: 'opencode-go/gpt-5.6-luna', reasoningEffort: 'high' } }, AVAILABLE);
    expect(seeded.lead).toEqual({ model: 'opencode-go/gpt-5.6-luna', reasoningEffort: 'high' });
    expect(seeded.tester).toEqual({ model: 'opencode-go/gemini-4-argon-contributor', reasoningEffort: 'medium' });
  });

  it('preserves explicitly selected Astra and cheap UX models until the user resets them', () => {
    const existing: TeamConfig = {
      architect: { model: 'openai/gpt-6-astra', reasoningEffort: 'xhigh' },
      ux: { model: 'opencode-go/qwen3.8-flash', reasoningEffort: 'high' },
    };
    const seeded = seedDefaults(existing, AVAILABLE);
    expect(seeded.architect).toEqual(existing.architect);
    expect(seeded.ux).toEqual(existing.ux);
  });

  it('does not mutate the existing config', () => {
    const existing = { lead: { model: 'x' } as const };
    seedDefaults(existing, AVAILABLE);
    expect(existing).toEqual({ lead: { model: 'x' } });
  });
});

describe('resetAgent / resetAllToDefaults', () => {
  it('restores a single agent to its default', () => {
    const config: TeamConfig = { lead: { model: 'opencode-go/gpt-5.6-luna', reasoningEffort: 'high' } };
    const choice = resetAgent(config, 'lead', AVAILABLE);
    expect(choice).toEqual({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' });
    expect(config.lead).toEqual(choice);
  });

  it('resets the agent to inherit when its default model is unavailable', () => {
    const config: TeamConfig = { lead: { model: 'custom/x', reasoningEffort: 'high' } };
    expect(resetAgent(config, 'lead', ['google-vertex/gemini-2.5-pro'])).toBeUndefined();
    expect(config.lead).toEqual({});
  });

  it('resets every agent and returns the names of resolved defaults', () => {
    const config: TeamConfig = { lead: { model: 'custom/x' }, tester: {} };
    const names = resetAllToDefaults(config, ['lead', 'tester', 'ux'], AVAILABLE);
    expect(names).toEqual(['lead', 'tester', 'ux']);
    expect(config.lead?.model).toBe('openai/gpt-6.1-sol');
    expect(config.tester?.model).toBe('opencode-go/gemini-4-argon-contributor');
  });
});

describe('Planner to Analyst migration', () => {
  it('copies legacy choices without mutating the source or overriding Analyst', () => {
    const previous = { planner: { model: 'custom/model', reasoningEffort: 'high', additionalTools: ['lookup'] } };
    const migrated = migratePlannerConfig(previous);
    expect(migrated.analyst).toEqual(previous.planner);
    migrated.analyst.additionalTools?.push('other');
    expect(previous.planner.additionalTools).toEqual(['lookup']);
    expect(migratePlannerConfig({ ...previous, analyst: {} }).analyst).toEqual({});
  });
});
