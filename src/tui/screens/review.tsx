import React from 'react';
import { Box, Text } from 'ink';
import { resolve } from 'node:path';
import { loadPersonalRulesFile } from '../../installer/personalInstructions.js';
import type { Action, SessionState } from '../state.js';
import { HARNESS_LAYOUTS } from '../../installer/harness.js';
import { wrapLines } from '../layout.js';
import type { MenuItem } from '../components/controls.js';
import { MenuList } from '../components/controls.js';
import { palette } from '../theme.js';

export function scopeLines(state: SessionState): { project: string[]; personal: string[] } {
  const layout = HARNESS_LAYOUTS[state.harness];
  const project = [
    `${layout.agents}/ — eight agent definitions (models/effort applied, your edits preserved unless overwrite is on)`,
    `${layout.skills}/ — shipped skills (unowned names need adoption below)`,
    `${layout.config} — saved team configuration`,
    '.gitignore — managed block for the installed paths (rest of the file untouched)',
    `.vscode/settings.json — Quick Open pass-through (${state.vscodeKept ? 'already configured, kept' : 'will be added'})`,
  ];
  const personal = [
    `Private personal instructions: ${state.personalRules.trim() ? 'loaded' : 'none'} (user configuration, never committed)`,
  ];
  return { project, personal };
}

export function reviewFocusIds(state: SessionState): string[] {
  return reviewItems(state).map((item) => item.id);
}

export const REVIEW_NOTE = 'Startup model routing stays with the harness runtime. Effort controls apply to OpenCode/Codex only.';

/** Non-scrollable rows (everything except the review list). */
export function reviewFixedRows(width: number, compact: boolean): number {
  if (compact) return 0;
  return 1 + wrapLines(REVIEW_NOTE, width).length + 1;
}

export function currentHint(choice: { model?: string; reasoningEffort?: string } | undefined): string {
  if (!choice?.model) return 'unset (inherit harness model)';
  return choice.reasoningEffort ? `${choice.model} @ ${choice.reasoningEffort}` : choice.model;
}

/** Returns 'install' when the session may exit to the writer, else an Action. */
export function activateReview(state: SessionState, id: string): Action | 'install' | null {
  if (id === 'back') return { type: 'NAV', to: 'instructions' };
  if (id === 'adopt') return { type: 'SET_ADOPT_SKILLS', adopt: !state.adoptSkills };
  // Info rows scroll but never activate.
  if (id.startsWith('info:') || id.startsWith('line:')) return null;
  if (id !== 'install') return { type: 'NOTICE', notice: null };
  if (state.skillConflicts.length > 0 && !state.adoptSkills) {
    return { type: 'ERROR', error: `Unowned skill folders need explicit adoption: ${state.skillConflicts.join(', ')}. Toggle adoption or rerun with --replace-skills.` };
  }
  return 'install';
}

export function reviewItems(state: SessionState): MenuItem[] {
  const { project, personal } = scopeLines(state);
  const roles = ['analyst', 'lead', 'architect', 'security', 'ux', 'tester', 'developer', 'reviewer'] as const;
  const items: MenuItem[] = [
    { id: 'line:target', label: `Harness: ${state.harness}   Target: ${state.targetDir}` },
    ...roles.map((name) => ({
      id: `line:${name}`,
      label: `${name}: ${currentHint(state.config[name])}`,
      hint: `instructions ${state.overwrite[name] ? 'refresh' : 'preserve'}`,
    })),
    { id: 'line:project', label: 'Project writes (this folder):' },
    ...project.map((line, index) => ({ id: `line:project-${index}`, label: line })),
    { id: 'line:personal', label: 'Personal writes (your user config, never the repo):' },
    ...personal.map((line, index) => ({ id: `line:personal-${index}`, label: line })),
  ];
  if (state.skillConflicts.length > 0) {
    items.push({
      id: 'adopt',
      label: `Adopt/replace unowned skill folders: ${state.skillConflicts.join(', ')}`,
      hint: 'Enter toggles',
      state: state.adoptSkills ? 'checked' : 'unchecked',
    });
  }
  items.push({ id: 'install', label: 'Install — apply this configuration' });
  items.push({ id: 'back', label: 'Back to personal instructions' });
  return items;
}

export function ReviewScreen(options: { state: SessionState; width: number; listHeight: number; compact: boolean; hintMode?: 'all' | 'focused' | 'none' }): React.JSX.Element {
  const { state, width, listHeight, compact, hintMode } = options;
  return (
    <Box flexDirection="column">
      {!compact && <Text color={palette.cream} bold>Review and install</Text>}
      {!compact && (
        <Text color={palette.parchment} wrap="wrap">{REVIEW_NOTE}</Text>
      )}
      <Box marginTop={compact ? 0 : 1}>
        <MenuList items={reviewItems(state)} focusedId={state.focusId} viewportHeight={listHeight} width={width} compact={compact} hintMode={hintMode} />
      </Box>
    </Box>
  );
}

export function reviewShortcuts(): string[] {
  return ['↑↓ navigate', 'Enter activate', 'Esc quit'];
}

/** Shared by the CLI reporter so shell output matches the review screen. */
export function describeRulesSource(rules: string): string {
  return rules.trim() ? 'loaded' : 'none';
}

export function validateDraftPath(path: string): string {
  return loadPersonalRulesFile(resolve(path.trim()));
}
