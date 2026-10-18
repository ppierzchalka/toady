import { deriveEffortLevels } from '../installer/model-catalog.js';
import { resetAllToDefaults, resolveDefault } from '../installer/defaults.js';
import type { Harness } from '../installer/harness.js';
import type { TeamConfig } from '../types.js';

/** Canonical eight-role ordering shared by every screen. */
export const AGENT_ORDER = ['analyst', 'lead', 'architect', 'security', 'ux', 'tester', 'developer', 'reviewer'] as const;
export type AgentName = (typeof AGENT_ORDER)[number];

export type Step = 'directory' | 'agents' | 'instructions' | 'review';

export type DiscoveryStatus = 'loading' | 'ready' | 'unavailable';

export interface DiscoveryState {
  status: DiscoveryStatus;
  models: string[];
  /** Truthful short note (e.g. which providers answered); never raw stderr or secrets. */
  detail: string;
}

export interface RulesBrowserState {
  open: boolean;
  dir: string;
  showHidden: boolean;
  focusId: string;
  scrollTop: number;
  error: string | null;
}

/** Native single-target folder picker on the directory step. Browsing only
 * navigates; the committed session target changes solely through an explicit
 * Use-this-folder action (with dirty-edit consent when needed). */
export interface TargetBrowserState {
  open: boolean;
  dir: string;
  showHidden: boolean;
  focusId: string;
  scrollTop: number;
  error: string | null;
}

/** Refresh payload loaded from a newly chosen target. Personal instructions
 * settings are user/harness-scoped and deliberately absent here. */
export interface TargetPending {
  dir: string;
  config: TeamConfig;
  skillConflicts: string[];
  vscodeKept: boolean;
}

export type DraftKind = 'model-custom' | 'model-id' | 'tools' | 'rules-path' | null;

export interface QuitSnapshot {
  step: Step;
  focusId: string;
  scrollTop: number;
  region: number;
  search: string;
  draft: string;
  draftFor: DraftKind;
  cursor: number;
  agentDetail: string | null;
  rulesBrowser: RulesBrowserState;
  targetBrowser: TargetBrowserState;
  targetPending: TargetPending | null;
  detail: DetailState | null;
  // Diagnostics are session UI state: the snapshot preserves them so that
  // Continue restores the exact pre-dialog view. Nothing mutates while the
  // dialog is open, so this is a complete invariant, not a selection.
  notice: string | null;
  error: string | null;
}

/** Non-mutating full-detail pager for capped focused values and errors. */
export interface DetailState {
  title: string;
  lines: string[];
  top: number;
}

/** Single source of truth for the installer session. No React/Ink dependency. */
export interface SessionState {
  step: Step;
  targetDir: string;
  harness: Harness;
  config: TeamConfig;
  overwrite: Record<string, boolean>;
  /** Focused item id within the current screen (menu id, agent name, ...). */
  focusId: string;
  scrollTop: number;
  /** Tab focus region index within the current screen. */
  region: number;
  /** Open agent editor (`agentDetail`) or null for the role list. */
  agentDetail: string | null;
  /** Within an agent editor: which editor field is active. */
  editorField: 'model' | 'effort' | 'overwrite' | 'tools' | 'reset' | 'back';
  search: string;
  draft: string;
  draftFor: DraftKind;
  /** Cursor offset (chars) inside the active draft. */
  cursor: number;
  editorMode: 'list' | 'custom' | 'path';
  personalRules: string;
  jevRequested?: boolean;
  jevTouched?: boolean;
  /** True once personal instructions are edited; used to resolve saved harness settings. */
  rulesTouched: boolean;
  rulesBrowser: RulesBrowserState;
  targetBrowser: TargetBrowserState;
  /** Pending target switch awaiting explicit discard-consent; null otherwise. */
  targetPending: TargetPending | null;
  /** True once the user edits agent settings; gates discard-consent. */
  settingsTouched: boolean;
  /** Roles edited this session must not be changed by late model discovery. */
  editedAgents: string[];
  discovery: DiscoveryState;
  notice: string | null;
  error: string | null;
  skillConflicts: string[];
  adoptSkills: boolean;
  vscodeKept: boolean;
  quitDialog: QuitSnapshot | null;
  /** Non-mutating full-detail pager overlay; focus/draft/config untouched. */
  detail: DetailState | null;
  installRequested: boolean;
}

export interface InitialOptions {
  targetDir: string;
  harness: Harness;
  config: TeamConfig;
  overwrite: Record<string, boolean>;
  personalRules: string;
  jevRequested?: boolean;
  skillConflicts: string[];
  vscodeKept: boolean;
}

export function createInitialState(options: InitialOptions): SessionState {
  const overwrite: Record<string, boolean> = {};
  for (const name of AGENT_ORDER) overwrite[name] = options.overwrite[name] ?? true;
  return {
    step: 'directory',
    targetDir: options.targetDir,
    harness: options.harness,
    config: structuredClone(options.config),
    overwrite,
    focusId: 'confirm',
    scrollTop: 0,
    region: 0,
    agentDetail: null,
    editorField: 'model',
    search: '',
    draft: '',
    draftFor: null,
    cursor: 0,
    editorMode: 'list',
    personalRules: options.personalRules,
    jevRequested: options.jevRequested ?? false,
    jevTouched: false,
    rulesTouched: false,
    rulesBrowser: { open: false, dir: options.targetDir, showHidden: false, focusId: '..', scrollTop: 0, error: null },
    targetBrowser: { open: false, dir: options.targetDir, showHidden: false, focusId: '..', scrollTop: 0, error: null },
    targetPending: null,
    settingsTouched: false,
    editedAgents: [],
    discovery: { status: 'loading', models: [], detail: 'Detecting providers…' },
    notice: null,
    error: null,
    skillConflicts: options.skillConflicts,
    adoptSkills: false,
    vscodeKept: options.vscodeKept,
    quitDialog: null,
    detail: null,
    installRequested: false,
  };
}

export type Action =
  | { type: 'NAV'; to: Step }
  | { type: 'SET_HARNESS'; harness: Harness }
  | { type: 'FOCUS'; id: string }
  | { type: 'SCROLL'; top: number }
  | { type: 'SET_REGION'; region: number }
  | { type: 'OPEN_AGENT'; name: string }
  | { type: 'CLOSE_AGENT' }
  | { type: 'SET_EDITOR_FIELD'; field: SessionState['editorField'] }
  | { type: 'SET_EDITOR_MODE'; mode: SessionState['editorMode'] }
  | { type: 'SET_MODEL'; name: string; model: string | undefined }
  | { type: 'SET_EFFORT'; name: string; effort: string | undefined }
  | { type: 'TOGGLE_OVERWRITE'; name: string }
  | { type: 'SET_TOOLS'; name: string; tools: string[] }
  | { type: 'RESET_AGENT'; name: string }
  | { type: 'RESET_ALL' }
  | { type: 'SET_SEARCH'; value: string }
  | { type: 'SET_DRAFT'; for: DraftKind; value: string; cursor?: number }
  | { type: 'SET_CURSOR'; cursor: number }
  | { type: 'CLEAR_DRAFT' }
  | { type: 'TOGGLE_JEV' }
  | { type: 'SET_RULES'; rules: string }
  | { type: 'CLEAR_RULES' }
  | { type: 'OPEN_RULES_BROWSER' }
  | { type: 'CLOSE_RULES_BROWSER' }
  | { type: 'OPEN_TARGET_BROWSER' }
  | { type: 'CLOSE_TARGET_BROWSER' }
  | { type: 'TARGET_NAV'; dir: string }
  | { type: 'TARGET_HIDDEN'; show: boolean }
  | { type: 'TARGET_ERROR'; error: string | null }
  | { type: 'REQUEST_TARGET'; dir: string; config: TeamConfig; skillConflicts: string[]; vscodeKept: boolean }
  | { type: 'CANCEL_TARGET' }
  | { type: 'APPLY_TARGET_PENDING' }
  | { type: 'SET_TARGET'; dir: string; config: TeamConfig; skillConflicts: string[]; vscodeKept: boolean }
  | { type: 'REFRESH_HARNESS'; skillConflicts: string[]; vscodeKept: boolean }
  | { type: 'BROWSER_NAV'; dir: string }
  | { type: 'BROWSER_HIDDEN'; show: boolean }
  | { type: 'BROWSER_ERROR'; error: string | null }
  | { type: 'SET_ADOPT_SKILLS'; adopt: boolean }
  | { type: 'OPEN_DETAIL'; title: string; lines: string[] }
  | { type: 'DETAIL_SCROLL'; top: number }
  | { type: 'CLOSE_DETAIL' }
  | { type: 'SET_DISCOVERY'; discovery: DiscoveryState }
  | { type: 'NOTICE'; notice: string | null }
  | { type: 'ERROR'; error: string | null }
  | { type: 'REQUEST_QUIT' }
  | { type: 'QUIT_CONTINUE' }
  | { type: 'REQUEST_INSTALL' };

function snapshotOf(state: SessionState): QuitSnapshot {
  return {
    step: state.step,
    focusId: state.focusId,
    scrollTop: state.scrollTop,
    region: state.region,
    search: state.search,
    draft: state.draft,
    draftFor: state.draftFor,
    cursor: state.cursor,
    agentDetail: state.agentDetail,
    rulesBrowser: structuredClone(state.rulesBrowser),
    targetBrowser: structuredClone(state.targetBrowser),
    targetPending: state.targetPending ? structuredClone(state.targetPending) : null,
    detail: state.detail ? structuredClone(state.detail) : null,
    notice: state.notice,
    error: state.error,
  };
}

function restoreSnapshot(state: SessionState, snapshot: QuitSnapshot): SessionState {
  return {
    ...state,
    step: snapshot.step,
    focusId: snapshot.focusId,
    scrollTop: snapshot.scrollTop,
    region: snapshot.region,
    search: snapshot.search,
    draft: snapshot.draft,
    draftFor: snapshot.draftFor,
    cursor: snapshot.cursor,
    agentDetail: snapshot.agentDetail,
    rulesBrowser: structuredClone(snapshot.rulesBrowser),
    targetBrowser: structuredClone(snapshot.targetBrowser),
    targetPending: snapshot.targetPending ? structuredClone(snapshot.targetPending) : null,
    detail: snapshot.detail ? structuredClone(snapshot.detail) : null,
    quitDialog: null,
    notice: snapshot.notice,
    error: snapshot.error,
  };
}

function clearScreenTransient(state: SessionState, step: Step, focusId: string): SessionState {
  return {
    ...state,
    step,
    focusId,
    scrollTop: 0,
    region: 0,
    search: '',
    draft: '',
    draftFor: null,
    cursor: 0,
    editorMode: 'list',
    agentDetail: step === 'agents' ? state.agentDetail : null,
    notice: null,
    error: null,
  };
}

export function modelChoicesFor(state: SessionState, name: string): { provider: string; levels: string[] } {
  const model = state.config[name]?.model;
  const provider = model?.split('/')[0] ?? 'unknown';
  return { provider, levels: deriveEffortLevels(provider, model) };
}

/** Apply a loaded target refresh atomically: new target owns config,
 * conflicts and editor status; user-scoped instructions are untouched. The session
 * edit baseline resets, so a later switch re-arms discard-consent. */
function applyTarget(
  state: SessionState,
  payload: { dir: string; config: TeamConfig; skillConflicts: string[]; vscodeKept: boolean },
): SessionState {
  const overwrite: Record<string, boolean> = {};
  for (const name of AGENT_ORDER) overwrite[name] = true;
  return withDefaults({
    ...state,
    targetDir: payload.dir,
    config: structuredClone(payload.config),
    overwrite,
    skillConflicts: [...payload.skillConflicts],
    vscodeKept: payload.vscodeKept,
    adoptSkills: false,
    targetBrowser: { ...state.targetBrowser, open: false, error: null },
    targetPending: null,
    settingsTouched: false,
    editedAgents: [],
    focusId: 'confirm',
    scrollTop: 0,
    region: 0,
    notice: `Target ${payload.dir} — loaded its saved configuration. Personal settings are unchanged.`,
    error: null,
  });
}

/** Seed available recommendations without replacing saved models or session edits. */
function withDefaults(state: SessionState): SessionState {
  if (state.harness !== 'opencode' || state.discovery.status !== 'ready') return state;
  const config = { ...state.config };
  for (const name of AGENT_ORDER) {
    if (config[name]?.model || state.editedAgents.includes(name)) continue;
    const choice = resolveDefault(name, state.discovery.models);
    if (choice) config[name] = { ...config[name], ...choice };
  }
  return { ...state, config };
}

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'NAV':
      return clearScreenTransient(state, action.to, action.to === 'directory' ? 'confirm' : action.to === 'agents' ? state.harness : action.to === 'instructions' ? 'rules-browse' : 'install');
    case 'SET_HARNESS':
      // Retain committed model choices across harness switches; never wipe.
      return withDefaults({ ...state, harness: action.harness, focusId: action.harness, notice: null, error: null });
    case 'FOCUS':
      return { ...state, focusId: action.id };
    case 'SCROLL':
      return { ...state, scrollTop: Math.max(0, action.top) };
    case 'SET_REGION':
      return { ...state, region: Math.max(0, action.region) };
    case 'OPEN_AGENT':
      return { ...state, agentDetail: action.name, editorField: 'model', editorMode: 'list', search: '', draft: '', draftFor: null, cursor: 0, focusId: 'model', scrollTop: 0, region: 0, notice: null, error: null };
    case 'CLOSE_AGENT':
      // Back retains committed choices; drafts are discarded.
      return { ...state, agentDetail: null, editorMode: 'list', search: '', draft: '', draftFor: null, cursor: 0, focusId: state.agentDetail ?? state.focusId, scrollTop: 0, region: 0 };
    case 'SET_EDITOR_FIELD':
      return { ...state, editorField: action.field, focusId: action.field, draft: '', draftFor: null, cursor: 0, editorMode: 'list' };
    case 'SET_EDITOR_MODE':
      return { ...state, editorMode: action.mode, draft: '', draftFor: action.mode === 'list' ? null : state.draftFor };
    case 'SET_MODEL': {
      const current = state.config[action.name] ?? {};
      const next = { ...current };
      if (action.model) {
        next.model = action.model;
        const provider = action.model.split('/')[0];
        const levels = deriveEffortLevels(provider, action.model);
        if (current.reasoningEffort && !levels.includes(current.reasoningEffort)) delete next.reasoningEffort;
      } else {
        delete next.model;
      }
      return { ...state, config: { ...state.config, [action.name]: next }, draft: '', draftFor: null, cursor: 0, editorMode: 'list', search: '', error: null, settingsTouched: true, editedAgents: [...state.editedAgents, action.name] };
    }
    case 'SET_EFFORT': {
      const current = state.config[action.name] ?? {};
      const next = { ...current };
      if (action.effort) next.reasoningEffort = action.effort;
      else delete next.reasoningEffort;
      return { ...state, config: { ...state.config, [action.name]: next }, error: null, settingsTouched: true, editedAgents: [...state.editedAgents, action.name] };
    }
    case 'TOGGLE_OVERWRITE':
      return { ...state, overwrite: { ...state.overwrite, [action.name]: !state.overwrite[action.name] }, settingsTouched: true };
    case 'SET_TOOLS': {
      const current = state.config[action.name] ?? {};
      return { ...state, config: { ...state.config, [action.name]: { ...current, additionalTools: action.tools } }, draft: '', draftFor: null, cursor: 0, error: null, settingsTouched: true, editedAgents: [...state.editedAgents, action.name] };
    }
    case 'RESET_AGENT': {
      // Non-OpenCode harnesses have no default resolver: reset means a clean
      // return to inherited models, never an OpenCode default leak.
      if (state.harness !== 'opencode') {
        const cleared = { ...state.config, [action.name]: {} };
        return { ...state, config: cleared, notice: `Reset ${action.name} to inherited model.`, settingsTouched: true, editedAgents: [...state.editedAgents, action.name] };
      }
      const config = { ...state.config };
      const choice = resolveDefault(action.name, state.discovery.models);
      if (choice) config[action.name] = choice;
      return { ...state, config, notice: choice ? `Reset ${action.name} to ${choice.model}${choice.reasoningEffort ? ` @ ${choice.reasoningEffort}` : ''}.` : `No default available for ${action.name} — keeping current choice.`, settingsTouched: true };
    }
    case 'RESET_ALL': {
      if (state.harness !== 'opencode') {
        const cleared: TeamConfig = {};
        for (const name of AGENT_ORDER) cleared[name] = {};
        return { ...state, config: cleared, notice: 'Reset all to inherited models.', settingsTouched: true, editedAgents: [...AGENT_ORDER] };
      }
      const config = { ...state.config };
      const reset = resetAllToDefaults(config, AGENT_ORDER, state.discovery.models);
      return {
        ...state,
        config,
        notice: reset.length > 0 ? `Reset to defaults: ${reset.join(', ')}.` : 'No defaults available for resolved models — nothing changed.',
        settingsTouched: true,
      };
    }
    case 'SET_SEARCH':
      return { ...state, search: action.value, scrollTop: 0 };
    case 'SET_DRAFT': {
      const chars = [...action.value].length;
      const cursor = action.cursor === undefined ? chars : Math.max(0, Math.min(action.cursor, chars));
      return { ...state, draft: action.value, draftFor: action.for, cursor };
    }
    case 'SET_CURSOR':
      return { ...state, cursor: Math.max(0, Math.min(action.cursor, [...state.draft].length)) };
    case 'CLEAR_DRAFT':
      // Local cancel drops the draft and its draft-owned validation error;
      // unrelated errors never coexist with an active draft.
      return { ...state, draft: '', draftFor: null, cursor: 0, editorMode: 'list', error: null };
    case 'TOGGLE_JEV':
      if (state.harness !== 'opencode' || !state.discovery.models.some(m => /^opencode-go\\/jev(?:[-.][a-z0-9.-]+)?$/.test(m))) return state;
      return { ...state, jevRequested: !state.jevRequested, jevTouched: true };
    case 'SET_RULES':
      return { ...state, personalRules: action.rules, rulesTouched: true, rulesBrowser: { ...state.rulesBrowser, open: false, error: null }, draft: '', draftFor: null, cursor: 0, error: null };
    case 'CLEAR_RULES':
      return { ...state, personalRules: '', rulesTouched: true };
    case 'OPEN_RULES_BROWSER':
      return { ...state, focusId: '..', scrollTop: 0, region: 0, rulesBrowser: { ...state.rulesBrowser, open: true, dir: state.targetDir, focusId: '..', scrollTop: 0, error: null } };
    case 'CLOSE_RULES_BROWSER':
      // Explicit cancel keeps prior rules; focus returns to the browse row.
      return { ...state, focusId: 'rules-browse', scrollTop: 0, rulesBrowser: { ...state.rulesBrowser, open: false, error: null }, draft: '', draftFor: null, cursor: 0 };
    case 'BROWSER_NAV':
      return { ...state, focusId: '..', scrollTop: 0, rulesBrowser: { ...state.rulesBrowser, dir: action.dir, focusId: '..', scrollTop: 0, error: null } };
    case 'BROWSER_HIDDEN':
      return { ...state, rulesBrowser: { ...state.rulesBrowser, showHidden: action.show, scrollTop: 0 } };
    case 'BROWSER_ERROR':
      return { ...state, rulesBrowser: { ...state.rulesBrowser, error: action.error } };
    case 'OPEN_TARGET_BROWSER':
      return { ...state, focusId: 'info:browsed', scrollTop: 0, region: 0, targetBrowser: { open: true, dir: state.targetDir, showHidden: false, focusId: '..', scrollTop: 0, error: null } };
    case 'CLOSE_TARGET_BROWSER':
      // Explicit cancel keeps the committed target and session config.
      return { ...state, focusId: 'change', scrollTop: 0, targetBrowser: { ...state.targetBrowser, open: false, error: null }, draft: '', draftFor: null, cursor: 0 };
    case 'TARGET_NAV':
      return { ...state, focusId: 'info:browsed', scrollTop: 0, targetBrowser: { ...state.targetBrowser, dir: action.dir, focusId: '..', scrollTop: 0, error: null } };
    case 'TARGET_HIDDEN':
      return { ...state, targetBrowser: { ...state.targetBrowser, showHidden: action.show, scrollTop: 0 } };
    case 'TARGET_ERROR':
      return { ...state, targetBrowser: { ...state.targetBrowser, error: action.error } };
    case 'REQUEST_TARGET':
      return { ...state, focusId: 'target-confirm', scrollTop: 0, region: 0, targetPending: { dir: action.dir, config: structuredClone(action.config), skillConflicts: [...action.skillConflicts], vscodeKept: action.vscodeKept } };
    case 'CANCEL_TARGET':
      // Back to the open picker: the browsed directory is kept for another choice.
      return { ...state, focusId: '__use__', scrollTop: 0, targetPending: null };
    case 'APPLY_TARGET_PENDING':
      if (!state.targetPending) return state;
      return applyTarget(state, state.targetPending);
    case 'SET_TARGET':
      return applyTarget(state, { dir: action.dir, config: action.config, skillConflicts: action.skillConflicts, vscodeKept: action.vscodeKept });
    case 'REFRESH_HARNESS':
      // Harness switches refresh target-dependent conflicts/editor status but
      // retain committed model choices (approved retention behavior).
      return { ...state, skillConflicts: [...action.skillConflicts], vscodeKept: action.vscodeKept, adoptSkills: false };
    case 'SET_ADOPT_SKILLS':
      return { ...state, adoptSkills: action.adopt };
    case 'OPEN_DETAIL':
      return { ...state, detail: { title: action.title, lines: [...action.lines], top: 0 } };
    case 'DETAIL_SCROLL':
      return state.detail ? { ...state, detail: { ...state.detail, top: Math.max(0, action.top) } } : state;
    case 'CLOSE_DETAIL':
      return { ...state, detail: null };
    case 'SET_DISCOVERY':
      return withDefaults({ ...state, discovery: action.discovery });
    case 'NOTICE':
      return { ...state, notice: action.notice };
    case 'ERROR':
      return { ...state, error: action.error };
    case 'REQUEST_QUIT':
      if (state.quitDialog) return state;
      return { ...state, quitDialog: snapshotOf(state) };
    case 'QUIT_CONTINUE':
      if (!state.quitDialog) return state;
      return restoreSnapshot(state, state.quitDialog);
    case 'REQUEST_INSTALL':
      return { ...state, installRequested: true };
    default:
      return state;
  }
}
