import React from 'react';
import { Box, Text } from 'ink';
import type { Action, SessionState } from '../state.js';
import { AGENT_ORDER, modelChoicesFor } from '../state.js';
import { HARNESS_NAMES, supportsEffort, type Harness } from '../../installer/harness.js';
import { currentHint } from './review.js';
import type { MenuItem } from '../components/controls.js';
import { EditActions, MenuList, TextField } from '../components/controls.js';
import { wrapLines } from '../layout.js';
import { palette } from '../theme.js';

export interface ValueOption {
  id: string;
  label: string;
  hint?: string;
}

/** Model value options for the open agent editor (pure; search-aware). */
export function modelOptions(state: SessionState): ValueOption[] {
  if (state.harness === 'antigravity') {
    return [
      { id: 'inherit', label: 'Inherit session model' },
      { id: 'flash', label: 'Flash' },
      { id: 'pro', label: 'Pro' },
    ];
  }
  if (state.discovery.status === 'loading') {
    return [{ id: '__loading__', label: 'Detecting providers… results appear automatically' }];
  }
  const term = state.search.trim().toLowerCase();
  const matches = state.discovery.models.filter((model) => !term || model.toLowerCase().includes(term));
  const options: ValueOption[] = [{ id: '__inherit__', label: "Don't set (use current model)" }];
  const exact = term !== '' && matches.some((model) => model.toLowerCase() === term);
  if (term !== '' && !exact) {
    options.push({ id: `custom:${state.search.trim()}`, label: `Use "${state.search.trim()}"` });
  }
  for (const model of matches) options.push({ id: model, label: model });
  options.push({ id: '__custom__', label: 'Type your own model id…' });
  return options;
}

export function effortOptions(state: SessionState, name: string): ValueOption[] {
  const { levels } = modelChoicesFor(state, name);
  return [{ id: '__unset__', label: "Don't set" }, ...levels.map((level) => ({ id: level, label: level }))];
}

function fieldRows(state: SessionState, name: string): MenuItem[] {
  const rows: MenuItem[] = [];
  if (state.editorField !== 'model') rows.push({ id: 'field:model', label: 'Model', hint: state.config[name]?.model ?? 'unset (inherit harness model)' });
  if (supportsEffort(state.harness) && state.editorField !== 'effort') {
    rows.push({ id: 'field:effort', label: 'Reasoning effort', hint: state.config[name]?.reasoningEffort ?? 'not set' });
  }
  if (state.harness === 'antigravity' && state.editorField !== 'tools') {
    rows.push({ id: 'field:tools', label: 'Additional native tools', hint: state.config[name]?.additionalTools?.join(', ') || 'none; configure MCP servers in native agent file' });
  }
  rows.push({
    id: 'field:overwrite',
    label: 'Overwrite instructions',
    hint: state.overwrite[name] ? 'yes (canonical prompt)' : 'no (keep my edits)',
    state: state.overwrite[name] ? 'checked' : 'unchecked',
  });
  rows.push({ id: 'field:reset', label: state.harness === 'opencode' ? 'Reset to default' : 'Reset to inherited model' });
  rows.push({ id: 'field:back', label: 'Back' });
  return rows;
}

/** Linear focus order for the agents list screen. */
export function agentsListFocusIds(): string[] {
  return [...HARNESS_NAMES, ...AGENT_ORDER, '__reset_all__', '__back__', '__next__'];
}

export function agentsListItems(state: SessionState): MenuItem[] {
  const items: MenuItem[] = HARNESS_NAMES.map((harness) => ({
    id: harness,
    label: `Harness: ${harness}`,
    hint: state.harness === harness ? 'selected for this install' : undefined,
    state: state.harness === harness ? ('committed' as const) : undefined,
  }));
  for (const name of AGENT_ORDER) {
    items.push({ id: name, label: name, hint: currentHint(state.config[name]), state: state.config[name]?.model ? 'committed' : undefined });
  }
  items.push({ id: '__reset_all__', label: state.harness === 'opencode' ? 'Reset all to defaults' : 'Reset all to inherited models', hint: 'discard manual model picks' });
  items.push({ id: '__back__', label: 'Back to installation directory', hint: 'keep session choices; target switches need explicit confirm' });
  items.push({ id: '__next__', label: 'Next: personal instructions' });
  return items;
}

export function activateAgentsList(state: SessionState, id: string): Action | null {
  if (id === '__next__') return { type: 'NAV', to: 'instructions' };
  if (id === '__back__') return { type: 'NAV', to: 'directory' };
  if (id === '__reset_all__') return { type: 'RESET_ALL' };
  if ((HARNESS_NAMES as readonly string[]).includes(id)) return { type: 'SET_HARNESS', harness: id as Harness };
  if ((AGENT_ORDER as readonly string[]).includes(id)) return { type: 'OPEN_AGENT', name: id };
  return null;
}

/** Linear focus order inside an agent editor (values first, then field rows). */
export function editorFocusIds(state: SessionState, name: string): string[] {
  if (state.draftFor) return [];
  if (state.editorField === 'tools' || (state.harness !== 'opencode' && state.harness !== 'antigravity' && state.editorField === 'model')) {
    const textRow = state.editorField === 'tools' ? 'tools-text' : 'model-text';
    return [textRow, ...fieldRows(state, name).map((row) => row.id)];
  }
  const values = state.editorField === 'effort' ? effortOptions(state, name) : modelOptions(state);
  return [...values.map((option) => `value:${option.id}`), ...fieldRows(state, name).map((row) => row.id)];
}

export function editorItems(state: SessionState, name: string): MenuItem[] {
  if (state.editorField === 'tools') {
    return [
      { id: 'tools-text', label: 'Additional native tools', hint: state.config[name]?.additionalTools?.join(', ') || 'none; configure MCP servers in native agent file' },
      ...fieldRows(state, name),
    ];
  }
  if (state.harness !== 'opencode' && state.harness !== 'antigravity' && state.editorField === 'model') {
    return [
      { id: 'model-text', label: `Native model ID (${state.harness}); blank = inherit`, hint: state.config[name]?.model ?? 'unset (inherit harness model)' },
      ...fieldRows(state, name),
    ];
  }
  const values = state.editorField === 'effort' ? effortOptions(state, name) : modelOptions(state);
  const committed = state.editorField === 'effort' ? (state.config[name]?.reasoningEffort ?? '__unset__') : (state.config[name]?.model ?? '__inherit__');
  return [
    ...values.map((option) => ({ id: `value:${option.id}`, label: option.label, hint: option.hint, state: committed === option.id || (state.editorField === 'model' && option.id === `custom:${committed}`) ? ('committed' as const) : undefined })),
    ...fieldRows(state, name),
  ];
}

/** Activate (Enter) on an editor row. Text rows enter edit mode instead. */
export function activateEditor(state: SessionState, name: string, id: string): Action | null {
  if (id.startsWith('field:')) {
    const field = id.slice('field:'.length);
    if (field === 'overwrite') return { type: 'TOGGLE_OVERWRITE', name };
    if (field === 'reset') return { type: 'RESET_AGENT', name };
    if (field === 'back') return { type: 'CLOSE_AGENT' };
    return { type: 'SET_EDITOR_FIELD', field: field as SessionState['editorField'] };
  }
  if (id === 'model-text') {
    return { type: 'SET_DRAFT', for: 'model-id', value: state.config[name]?.model ?? '' };
  }
  if (id === 'tools-text') {
    return { type: 'SET_DRAFT', for: 'tools', value: state.config[name]?.additionalTools?.join(', ') ?? '' };
  }
  if (!id.startsWith('value:')) return null;
  const value = id.slice('value:'.length);
  if (state.editorField === 'effort') {
    return { type: 'SET_EFFORT', name, effort: value === '__unset__' ? undefined : value };
  }
  if (state.harness === 'antigravity') {
    return { type: 'SET_MODEL', name, model: value === 'inherit' ? undefined : value };
  }
  if (value === '__inherit__') return { type: 'SET_MODEL', name, model: undefined };
  if (value === '__custom__') return { type: 'SET_DRAFT', for: 'model-custom', value: '' };
  if (value === '__loading__') return null;
  if (value.startsWith('custom:')) return { type: 'SET_MODEL', name, model: value.slice('custom:'.length) };
  return { type: 'SET_MODEL', name, model: value };
}

/** Space on the agents list is a no-op (checkboxes live inside editors). */
export function toggleAgentsList(): Action | null {
  return null;
}

export function toggleEditor(state: SessionState, name: string, id: string): Action | null {
  if (id === 'field:overwrite') return { type: 'TOGGLE_OVERWRITE', name };
  return null;
}

/** Commit the active draft (Enter while editing). May throw for invalid input. */
export function commitEditorDraft(state: SessionState, name: string): Action {
  const value = state.draft.trim();
  if (state.draftFor === 'tools') {
    const tools = [...new Set(value.split(',').map((tool) => tool.trim()).filter(Boolean))];
    return { type: 'SET_TOOLS', name, tools };
  }
  if (state.draftFor === 'model-custom' || state.draftFor === 'model-id') {
    return { type: 'SET_MODEL', name, model: value === '' ? undefined : value };
  }
  return { type: 'CLEAR_DRAFT' };
}

/** 2 regions (list + search) for the searchable OpenCode model picker. */
export function editorRegionCount(state: SessionState): number {
  if (state.harness === 'opencode' && state.editorField === 'model' && !state.draftFor) return 2;
  return 1;
}

/**
 * Commit from the search region (Enter). Commits exactly what the footer
 * advertises — the exact match or the typed custom ID — and never the stale
 * list focus. An empty query commits nothing and returns to the list, so a
 * committed model is preserved unless inheritance is explicitly selected.
 */
export function commitSearch(state: SessionState, name: string): Action {
  const term = state.search.trim();
  if (term === '') return { type: 'SET_REGION', region: 0 };
  const exact = state.discovery.models.find((model) => model.toLowerCase() === term.toLowerCase());
  return { type: 'SET_MODEL', name, model: exact ?? term };
}

export const AGENTS_TITLE = 'Agents and models';
export const AGENTS_DESC = 'Choose a harness, then configure each role. Saved selections are kept; Back retains edits. Back to installation directory keeps session choices.';
export const DISCOVERY_LOADING = 'Detecting providers… the list updates automatically.';
export const EMPTY_CATALOG_NOTE = 'Empty catalog — inherit the harness model or type a custom ID.';

export function editorLabel(state: SessionState, name: string, minimal = false): string {
  if (minimal) {
    if (state.draftFor === 'tools') return 'Tool names:';
    return 'Model id:';
  }
  if (state.draftFor === 'tools') return 'Additional Antigravity tool names (comma-separated):';
  if (state.harness === 'opencode') return 'Model id (e.g. google/gemini-3.6-flash):';
  return `Native model ID for ${name} (${state.harness}); blank = inherit:`;
}

/** Non-scrollable rows (everything except the menu list / text field rows). */
export function agentsFixedRows(state: SessionState, width: number, compact: boolean, roomy: boolean, minimal = false, hintMode: 'all' | 'focused' | 'none' = compact ? 'focused' : 'all', editDetails = false): number {
  const editing = state.draftFor === 'model-custom' || state.draftFor === 'model-id' || state.draftFor === 'tools';
  if (!state.agentDetail) {
    const discovery = roomy && state.discovery.status === 'loading' ? wrapLines(DISCOVERY_LOADING, width).length : 0;
    if (compact) return discovery;
    return 1 + wrapLines(AGENTS_DESC, width).length + discovery + 1;
  }
  const name = state.agentDetail;
  if (editing) {
    const label = wrapLines(editorLabel(state, name, minimal), width).length;
    // Label rows, the single-line text field, and the explicit action rows.
    const actionCount = state.region === 1 ? (editDetails ? 3 : 2) : 0;
    const actions = actionCount === 0 ? 0 : (compact ? (hintMode === 'none' ? actionCount : actionCount + 1) : 1 + actionCount + 1);
    if (compact) return label + 1 + actions;
    return 1 + label + 1 + 1 + actions;
  }
  const title = compact ? 0 : wrapLines(`${name} — ${currentHint(state.config[name])}`, width).length;
  let search = 0;
  if (state.editorField === 'model' && state.harness === 'opencode') {
    search = 1;
    if (!compact && state.discovery.models.length === 0 && state.discovery.status === 'ready') {
      search += wrapLines(EMPTY_CATALOG_NOTE, width).length;
    }
  }
  const margin = compact ? 0 : 2;
  return title + search + margin;
}

export function agentsShortcuts(state: SessionState): string[] {
  if (state.agentDetail) {
    if (state.draftFor) {
      if (state.region === 1) return ['↑↓ choose action', 'Enter activate', 'Tab back to input', 'Esc quit dialog'];
      return ['Type to edit (paste works)', 'Enter commit', 'Tab actions (Commit/Cancel)', 'Esc quit dialog (draft kept)'];
    }
    if (state.region === 1) return ['Type to search', '↑↓ back to list', 'Enter commit match/custom', 'Esc clear search', 'Tab list'];
    const base = ['↑↓ navigate', 'Enter select', 'Space toggles overwrite', 'Home/End/PgUp/PgDn', 'Esc back'];
    if (editorRegionCount(state) > 1) base.splice(3, 0, 'Tab search');
    return base;
  }
  return ['↑↓ navigate', 'Enter open/choose', 'Home/End/PgUp/PgDn', 'Esc quit'];
}

export function AgentsScreen(options: { state: SessionState; width: number; listHeight: number; compact: boolean; roomy: boolean; hintMode?: 'all' | 'focused' | 'none'; minimal?: boolean; editDetails?: boolean }): React.JSX.Element {
  const { state, width, listHeight, compact, roomy, hintMode, minimal = false , editDetails = false } = options;
  if (!state.agentDetail) {
    return (
      <Box flexDirection="column">
        {!compact && <Text color={palette.cream} bold>{AGENTS_TITLE}</Text>}
        {!compact && <Text color={palette.parchment} wrap="wrap">{AGENTS_DESC}</Text>}
        {roomy && state.discovery.status === 'loading' && <Text color={palette.parchment} wrap="wrap">{DISCOVERY_LOADING}</Text>}
        <Box marginTop={compact ? 0 : 1}>
          <MenuList items={agentsListItems(state)} focusedId={state.focusId} viewportHeight={listHeight} width={width} compact={compact} hintMode={hintMode} />
        </Box>
      </Box>
    );
  }
  const name = state.agentDetail;
  const editing = state.draftFor === 'model-custom' || state.draftFor === 'model-id' || state.draftFor === 'tools';
  return (
    <Box flexDirection="column">
      {!compact && <Text color={palette.cream} bold>{`${name} — ${currentHint(state.config[name])}`}</Text>}
      {state.editorField === 'model' && state.harness === 'opencode' && !editing && (
        <Box marginTop={compact ? 0 : 1} flexDirection="column">
          <Text color={state.region === 1 ? palette.gold : palette.parchment} wrap={minimal ? 'truncate' : undefined}>{`Search models: ${state.search || '(all)'}`}</Text>
          {!compact && state.discovery.models.length === 0 && state.discovery.status === 'ready' && (
            <Text color={palette.parchment} wrap="wrap">{EMPTY_CATALOG_NOTE}</Text>
          )}
        </Box>
      )}
      {editing && (
        <Box marginTop={compact ? 0 : 1} flexDirection="column">
          <Text color={palette.gold} wrap="wrap">{editorLabel(state, name, minimal)}</Text>
          <TextField value={state.draft} cursor={state.cursor} focused={state.region === 0} width={width} />
          {state.region === 1 && (
            <Box marginTop={compact ? 0 : 1}>
              <EditActions focusedId={state.focusId} width={width} hintMode={hintMode} showDetails={editDetails} />
            </Box>
          )}
        </Box>
      )}
      {!editing && (
        <Box marginTop={compact ? 0 : 1}>
          <MenuList items={editorItems(state, name)} focusedId={state.focusId} viewportHeight={listHeight} width={width} compact={compact} hintMode={hintMode} />
        </Box>
      )}
    </Box>
  );
}
