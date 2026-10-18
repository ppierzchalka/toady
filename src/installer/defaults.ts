import type { AgentChoice, TeamConfig } from '../types.js';

interface DefaultRule {
  models: string[];
  reasoningEffort: string;
}

const DEFAULT_RULES: Record<string, DefaultRule> = {
  analyst: { models: ['openai/gpt-6.1-sol'], reasoningEffort: 'medium' },
  lead: { models: ['openai/gpt-6.1-sol'], reasoningEffort: 'medium' },
  architect: { models: ['openai/gpt-6-luna'], reasoningEffort: 'high' },
  security: { models: ['openai/gpt-6-luna'], reasoningEffort: 'high' },
  ux: { models: ['openai/gpt-6.1-sol'], reasoningEffort: 'medium' },
  tester: { models: ['opencode-go/gemini-4-argon-contributor'], reasoningEffort: 'medium' },
  developer: { models: ['opencode-go/deepseek-v4-pro'], reasoningEffort: 'medium' },
  reviewer: { models: ['opencode-go/deepseek-v4-pro'], reasoningEffort: 'high' },
};

export function resolveDefault(agent: string, available: string[]): AgentChoice | undefined {
  const rule = DEFAULT_RULES[agent];
  if (!rule) return undefined;
  const availableModels = new Set(available);
  for (const model of rule.models) {
    if (availableModels.has(model)) return { model, reasoningEffort: rule.reasoningEffort };
  }
  return undefined;
}

export function resetAgent(config: TeamConfig, name: string, available: string[]): AgentChoice | undefined {
  const choice = resolveDefault(name, available);
  config[name] = choice ?? {};
  return choice;
}

export function resetAllToDefaults(config: TeamConfig, names: readonly string[], available: string[]): string[] {
  const reset: string[] = [];
  for (const name of names) {
    if (resetAgent(config, name, available)) reset.push(name);
  }
  return reset;
}

export function seedDefaults(existing: TeamConfig, available: string[]): TeamConfig {
  const config: TeamConfig = structuredClone(existing);
  for (const name of Object.keys(DEFAULT_RULES)) {
    if (!config[name]?.model) {
      const choice = resolveDefault(name, available);
      if (choice) config[name] = choice;
    }
  }
  return config;
}

// Preserve explicit Analyst settings; inherit legacy Planner choices only once.
export function migratePlannerConfig(existing: TeamConfig): TeamConfig {
  const config = structuredClone(existing);
  if (!config.analyst && config.planner) config.analyst = structuredClone(config.planner);
  return config;
}
