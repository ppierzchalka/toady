import { dirname, join } from 'node:path';
import { conflictingSkills, installTeam, preflightTeam } from './installTeam.js';
import { planJev, preflightJev, writeJevSettings, type JevResult, type JevSelection } from './jev.js';
import { installPersonalInstructions } from './personalInstructions.js';
import { applyVscodeSettings, planVscodeSettings, preflightVscodeSettings, type VscodeResult } from './vscodeSettings.js';
import type { InstallOptions, InstallResult } from '../types.js';

export interface InstallPlan {
  options: InstallOptions;
  instructions?: string;
  jev?: JevSelection;
}

export interface InstallAllResult {
  target: string;
  team: InstallResult;
  instructionsPaths: string[];
  vscode: VscodeResult;
  jev?: JevResult;
}

/**
 * Single-cwd installation orchestration (replaces the retired multi-target
 * batch). Read-only validation across every write scope — team files, private
 * instructions and VS Code settings — runs before the first write.
 */
export function preflightAll(plan: InstallPlan): { vscodeKept: boolean } {
  preflightTeam(plan.options);
  installPersonalInstructions(plan.options.targetDir, plan.options.harness, true, plan.instructions);
  if (plan.jev !== undefined) preflightJev(plan.options.targetDir);
  preflightVscodeSettings(plan.options.targetDir);
  return { vscodeKept: planVscodeSettings(plan.options.targetDir).body === null };
}

export function installAll(plan: InstallPlan): InstallAllResult {
  // Validate every scope before the first write; each writer re-validates cheaply.
  preflightAll(plan);
  try {
    const runner = join(dirname(plan.options.skillDir), 'decision-gates', 'scripts', 'judge.mjs');
    const jev = plan.jev === undefined ? undefined : planJev(plan.jev, plan.options.harness ?? 'opencode', runner);
    const team = installTeam(plan.options);
    const instructionsPaths = installPersonalInstructions(plan.options.targetDir, plan.options.harness, false, plan.instructions);
    const vscode = applyVscodeSettings(plan.options.targetDir);
    if (jev) jev.paths = writeJevSettings(plan.options.targetDir, jev);
    return { target: plan.options.targetDir, team, instructionsPaths, vscode, jev };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Installation failed for ${plan.options.targetDir}: ${reason}. The target may be partially written; remaining scopes were not installed.`, { cause: error });
  }
}

/** Unowned shipped skill names that need explicit adoption for this plan. */
export function planSkillConflicts(plan: InstallPlan): string[] {
  return conflictingSkills(plan.options);
}
