import { stringify as yamlStringify } from 'yaml';
import { parse as tomlParse, stringify as tomlStringify } from 'smol-toml';
import type { AgentChoice } from '../types.js';

export const HARNESS_NAMES = ['opencode', 'claude-code', 'codex', 'antigravity', 'copilot'] as const;
export type Harness = typeof HARNESS_NAMES[number];

export const HARNESS_LAYOUTS: Record<Harness, { agents: string; skills: string; config: string; extension: string }> = {
  opencode: { agents: '.opencode/agents', skills: '.opencode/skills', config: '.opencode/team.config.json', extension: '.md' },
  'claude-code': { agents: '.claude/agents', skills: '.claude/skills', config: '.claude/team.config.json', extension: '.md' },
  codex: { agents: '.codex/agents', skills: '.agents/skills', config: '.codex/team.config.json', extension: '.toml' },
  antigravity: { agents: '.agents/agents', skills: '.agents/skills', config: '.agents/team.config.json', extension: '.md' },
  copilot: { agents: '.github/agents', skills: '.github/skills', config: '.github/team.config.json', extension: '.agent.md' },
};

export function isHarness(value: string): value is Harness {
  return HARNESS_NAMES.some((name) => name === value);
}

export function supportsEffort(harness: Harness): boolean {
  return harness === 'opencode' || harness === 'codex';
}

export function locateInstructions(body: string, harness: Harness): string {
  return body.replace(/(?<![\w./-])skills\/(autonomous-implement|wayfinder|slice|refine|plan|project-setup|architecture-assess|security-assess|interface-assess|test-design|implement-task|review-change|decision-gates)\//g, (_, name: string) => HARNESS_LAYOUTS[harness].skills + '/' + name + '/');
}

export function applyHarnessChoice(metadata: Record<string, unknown>, choice: AgentChoice | undefined, harness: Harness): void {
  if (harness === 'antigravity' && choice?.model && !['inherit', 'flash', 'pro'].includes(choice.model)) {
    throw new Error('Antigravity model must be inherit, flash or pro');
  }
  const modelKey = 'model';
  const effortKey = harness === 'codex' ? 'model_reasoning_effort' : 'reasoningEffort';
  if (choice?.model) metadata[modelKey] = choice.model;
  else delete metadata[modelKey];
  if (supportsEffort(harness) && choice?.reasoningEffort) metadata[effortKey] = choice.reasoningEffort;
  else delete metadata[effortKey];
  if (harness === 'antigravity' && choice?.additionalTools?.length) {
    const tools = Array.isArray(metadata.tools) ? metadata.tools as string[] : [];
    metadata.tools = [...new Set([...tools, ...choice.additionalTools])];
  }
}

export function reconcileAntigravityTools(metadata: Record<string, unknown>, previous: AgentChoice | undefined, current: AgentChoice | undefined): void {
  if (!Array.isArray(metadata.tools)) return;
  const removed = new Set((previous?.additionalTools ?? []).filter((tool) => !current?.additionalTools?.includes(tool)));
  const core = new Set(['view_file', 'grep_search', 'run_command', 'replace_file_content', 'invoke_subagent']);
  metadata.tools = (metadata.tools as string[]).filter((tool) => !removed.has(tool) || core.has(tool));
}

export function renderAgent(name: string, description: string, body: string, choice: AgentChoice | undefined, harness: Harness): string {
  const primary = name === 'analyst' || name === 'lead';
  const metadata: Record<string, unknown> = { name, description };
  if (harness === 'opencode') metadata.mode = primary ? 'primary' : 'all';
  if (harness === 'antigravity') {
    metadata.mainAgent = primary;
    metadata.subagent = true;
    metadata.tools = ['view_file', 'grep_search', 'run_command'];
    if (['analyst', 'lead', 'developer', 'tester'].includes(name)) {
      (metadata.tools as string[]).push('replace_file_content');
    }
    if (name === 'lead') (metadata.tools as string[]).push('invoke_subagent');
  }
  if (name === 'reviewer') {
    if (harness === 'opencode') metadata.permission = { edit: 'deny' };
    if (harness === 'claude-code') metadata.disallowedTools = ['Write', 'Edit', 'NotebookEdit'];
    if (harness === 'codex') metadata.sandbox_mode = 'read-only';
  }
  applyHarnessChoice(metadata, choice, harness);
  const instructions = locateInstructions(body, harness);
  if (harness === 'codex') return tomlStringify({ ...metadata, developer_instructions: instructions } as Parameters<typeof tomlStringify>[0]);
  return '---\n' + yamlStringify(metadata).trimEnd() + '\n---\n' + instructions;
}

export function updateTomlChoice(content: string, choice: AgentChoice | undefined): string {
  const data = tomlParse(content);
  applyHarnessChoice(data, choice, 'codex');
  return tomlStringify(data);
}
