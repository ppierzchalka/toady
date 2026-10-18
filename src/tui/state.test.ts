import { describe, it, expect } from 'vitest';
import { AGENT_ORDER, createInitialState, reducer, type SessionState } from './state.js';

function base(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...createInitialState({
      targetDir: '/repo',
      harness: 'opencode',
      config: { lead: { model: 'vertex/gemini' } },
      overwrite: {},
            personalRules: 'old rules',
      skillConflicts: [],
      vscodeKept: false,
    }),
    ...overrides,
  };
}

describe('installer session reducer', () => {
  it('automatically applies predefined models and efforts when discovery completes', () => {
    const state = reducer(base({ config: {} }), {
      type: 'SET_DISCOVERY',
      discovery: {
        status: 'ready',
        models: ['openai/gpt-6.1-sol', 'openai/gpt-6-luna', 'opencode-go/deepseek-v4-pro', 'opencode-go/deepseek-v4-flash', 'opencode-go/muse-spark-1.3-contributor'],
        detail: '',
      },
    });
    expect(state.config).toEqual({
      analyst: { model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' },
      lead: { model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' },
      architect: { model: 'openai/gpt-6-luna', reasoningEffort: 'xhigh' },
      security: { model: 'opencode-go/deepseek-v4-pro', reasoningEffort: 'high' },
      ux: { model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' },
      tester: { model: 'opencode-go/muse-spark-1.3-contributor', reasoningEffort: 'medium' },
      developer: { model: 'opencode-go/muse-spark-1.3-contributor', reasoningEffort: 'medium' },
      reviewer: { model: 'opencode-go/deepseek-v4-flash', reasoningEffort: 'medium' },
    });
    expect(state.settingsTouched).toBe(false);
  });

  it('keeps the eight-role ordering and seeds saved selections', () => {
    expect([...AGENT_ORDER]).toEqual(['analyst', 'lead', 'architect', 'security', 'ux', 'tester', 'developer', 'reviewer']);
    const state = base();
    expect(state.config.lead).toEqual({ model: 'vertex/gemini' });
    expect(state.step).toBe('directory');
  });

  it('fills unset saved roles without replacing saved models or tools', () => {
    const state = reducer(base({ config: { lead: { model: 'custom/saved', reasoningEffort: 'high' }, analyst: { additionalTools: ['custom-tool'] } } }), {
      type: 'SET_DISCOVERY', discovery: { status: 'ready', models: ['openai/gpt-6.1-sol'], detail: '' },
    });
    expect(state.config.lead).toEqual({ model: 'custom/saved', reasoningEffort: 'high' });
    expect(state.config.analyst).toEqual({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium', additionalTools: ['custom-tool'] });
    expect(state.config.developer).toBeUndefined();
  });

  it('preserves explicit inheritance and edits made before discovery completes', () => {
    let state = base({ config: {} });
    state = reducer(state, { type: 'SET_MODEL', name: 'analyst', model: undefined });
    state = reducer(state, { type: 'SET_MODEL', name: 'lead', model: 'custom/selected' });
    state = reducer(state, { type: 'SET_DISCOVERY', discovery: { status: 'ready', models: ['openai/gpt-6.1-sol'], detail: '' } });
    expect(state.config.analyst).toEqual({});
    expect(state.config.lead).toEqual({ model: 'custom/selected' });
    expect(state.config.ux).toEqual({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' });
  });

  it('does not seed another harness, but seeds when switching to OpenCode', () => {
    let state = reducer(base({ harness: 'codex', config: {} }), {
      type: 'SET_DISCOVERY', discovery: { status: 'ready', models: ['openai/gpt-6.1-sol'], detail: '' },
    });
    expect(state.config).toEqual({});
    state = reducer(state, { type: 'SET_HARNESS', harness: 'opencode' });
    expect(state.config.lead?.model).toBe('openai/gpt-6.1-sol');
  });

  it('seeds a newly selected target using the already discovered catalog', () => {
    let state = base({ discovery: { status: 'ready', models: ['openai/gpt-6.1-sol'], detail: '' } });
    state = reducer(state, { type: 'SET_MODEL', name: 'analyst', model: undefined });
    state = reducer(state, { type: 'SET_TARGET', dir: '/other', config: { lead: { model: 'custom/other' } }, skillConflicts: [], vscodeKept: false });
    expect(state.config.lead?.model).toBe('custom/other');
    expect(state.config.analyst?.model).toBe('openai/gpt-6.1-sol');
    expect(state.settingsTouched).toBe(false);
  });

  it('retains committed choices on Back and discards only the draft on editor cancel', () => {
    let state = base({ step: 'agents' });
    state = reducer(state, { type: 'OPEN_AGENT', name: 'lead' });
    state = reducer(state, { type: 'SET_MODEL', name: 'lead', model: 'custom/model' });
    state = reducer(state, { type: 'SET_DRAFT', for: 'tools', value: 'half-typed' });
    state = reducer(state, { type: 'CLOSE_AGENT' });
    expect(state.config.lead?.model).toBe('custom/model');
    expect(state.draft).toBe('');
    expect(state.agentDetail).toBeNull();
    expect(state.focusId).toBe('lead');
  });

  it('clears an incompatible effort when the model changes, without touching other roles', () => {
    let state = base({ step: 'agents' });
    state = reducer(state, { type: 'SET_MODEL', name: 'architect', model: 'openai/gpt-6-luna' });
    state = reducer(state, { type: 'SET_EFFORT', name: 'architect', effort: 'xhigh' });
    state = reducer(state, { type: 'SET_MODEL', name: 'architect', model: 'anthropic/claude' });
    expect(state.config.architect?.reasoningEffort).toBeUndefined();
    expect(state.config.lead?.model).toBe('vertex/gemini');
  });

  it('toggles overwrite per role and resets roles independently', () => {
    let state = base({
      discovery: { status: 'ready', models: ['openai/gpt-6.1-sol'], detail: '' },
      config: { analyst: { model: 'custom/old' } },
    });
    state = reducer(state, { type: 'TOGGLE_OVERWRITE', name: 'analyst' });
    expect(state.overwrite.analyst).toBe(false);
    state = reducer(state, { type: 'RESET_AGENT', name: 'analyst' });
    expect(state.config.analyst?.model).toBe('openai/gpt-6.1-sol');
    expect(state.notice).toContain('Reset analyst');
  });

  it('keeps the current choice when no default is available', () => {
    let state = base({ discovery: { status: 'ready', models: [], detail: '' }, config: { ux: { model: 'mine/model' } } });
    state = reducer(state, { type: 'RESET_AGENT', name: 'ux' });
    expect(state.config.ux?.model).toBe('mine/model');
    expect(state.notice).toContain('keeping current choice');
  });

  it('restores the exact draft, focus, search and scroll after quit-continue', () => {
    let state = base({ step: 'agents', agentDetail: 'lead', focusId: 'effort', search: 'luna', scrollTop: 7, region: 1 });
    state = reducer(state, { type: 'SET_DRAFT', for: 'model-custom', value: 'half-typed-id' });
    state = reducer(state, { type: 'REQUEST_QUIT' });
    expect(state.quitDialog).not.toBeNull();
    // Dialog navigation must not disturb the snapshot.
    state = reducer(state, { type: 'FOCUS', id: 'quit' });
    state = reducer(state, { type: 'QUIT_CONTINUE' });
    expect(state.quitDialog).toBeNull();
    expect(state).toMatchObject({ step: 'agents', agentDetail: 'lead', focusId: 'effort', search: 'luna', scrollTop: 7, region: 1, draft: 'half-typed-id', draftFor: 'model-custom' });
  });

  it('cancelling the rules browser keeps prior rules', () => {
    let state = base({ step: 'instructions' });
    state = reducer(state, { type: 'OPEN_RULES_BROWSER' });
    expect(state.rulesBrowser.open).toBe(true);
    state = reducer(state, { type: 'BROWSER_NAV', dir: '/tmp' });
    state = reducer(state, { type: 'CLOSE_RULES_BROWSER' });
    expect(state.rulesBrowser.open).toBe(false);
    expect(state.personalRules).toBe('old rules');
  });

  it('committing rules closes the browser and marks the instructions as touched', () => {
    let state = base({ step: 'instructions' });
    state = reducer(state, { type: 'SET_RULES', rules: 'New rules.' });
    expect(state.personalRules).toBe('New rules.');
    expect(state.rulesTouched).toBe(true);
    expect(state.rulesBrowser.open).toBe(false);
  });

  it('switching harness retains committed model choices', () => {
    let state = base({ step: 'agents' });
    state = reducer(state, { type: 'SET_HARNESS', harness: 'codex' });
    expect(state.harness).toBe('codex');
    expect(state.config.lead?.model).toBe('vertex/gemini');
  });

  it('resets non-OpenCode roles to inheritance without leaking OpenCode defaults', () => {
    let state = base({
      harness: 'codex',
      discovery: { status: 'ready', models: ['openai/gpt-6.1-sol'], detail: '' },
      config: { analyst: { model: 'openai/gpt-5', reasoningEffort: 'high' } },
    });
    state = reducer(state, { type: 'RESET_AGENT', name: 'analyst' });
    expect(state.config.analyst).toEqual({});
    expect(state.notice).toContain('inherited model');
    state = reducer(state, { type: 'RESET_ALL' });
    for (const name of AGENT_ORDER) expect(state.config[name]).toEqual({});
    expect(state.notice).toContain('inherited models');
  });

  it('resets Antigravity tiers and tools to inheritance', () => {
    let state = base({
      harness: 'antigravity',
      discovery: { status: 'ready', models: [], detail: '' },
      config: { lead: { model: 'pro', additionalTools: ['x'] } },
    });
    state = reducer(state, { type: 'RESET_AGENT', name: 'lead' });
    expect(state.config.lead).toEqual({});
  });

  it('normalizes browser focus on open, navigation and cancel', () => {
    let state = base({ step: 'instructions', focusId: 'rules-browse' });
    state = reducer(state, { type: 'OPEN_RULES_BROWSER' });
    expect(state.rulesBrowser.open).toBe(true);
    expect(state.focusId).toBe('..');
    state = reducer(state, { type: 'FOCUS', id: 'some-file' });
    state = reducer(state, { type: 'BROWSER_NAV', dir: '/tmp' });
    expect(state.focusId).toBe('..');
    state = reducer(state, { type: 'CLOSE_RULES_BROWSER' });
    expect(state.rulesBrowser.open).toBe(false);
    expect(state.focusId).toBe('rules-browse');
  });
});
