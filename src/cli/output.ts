import type { InstallAllResult } from '../installer/installAll.js';
import type { BuildInfo } from './buildInfo.js';

/** Durable console report after the terminal is restored. No keypress gates. */
export function reportInstall(result: InstallAllResult, harness: string, build: BuildInfo): void {
  console.log(`\nInstalled ${harness} into ${result.target} [build ${build.tag}]`);
  for (const path of result.instructionsPaths) console.log(`  wrote  ${path}`);
  for (const path of result.team.written) console.log(`  wrote  ${path}`);
  for (const path of result.team.preserved) console.log(`  kept   ${path} (instructions preserved)`);
  for (const path of result.team.skillPaths) console.log(`  wrote  ${path}`);
  console.log(`  wrote  ${result.team.configPath}`);
  console.log(`  wrote  ${result.team.gitignorePath}`);
  console.log(`  ${result.vscode.status === 'wrote' ? 'wrote ' : 'kept  '} ${result.vscode.path} (Ctrl+P reaches apps in the integrated terminal)`);
  for (const path of result.team.removed) console.log(`  removed ${path} (unchanged retired definition)`);
  for (const path of result.team.legacyPreserved) console.log(`  kept   ${path} (custom/unrecognized legacy definition; migrate to analyst before removing)`);
  console.log('\nCompleted 1 target (single-target install). Shared skills refreshed; unrelated harnesses preserved; .gitignore keeps a managed block for the installed files.');
  console.log('\nNext: use Analyst with /project-setup, /wayfinder, /slice or /refine; /plan is optional; use Lead with /autonomous-implement for ready Tickets.');
}
