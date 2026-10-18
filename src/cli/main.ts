import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, USAGE } from './args.js';
import { installerPaths, resolvePackageRoot } from './assets.js';
import { readBuildInfo } from './buildInfo.js';
import { reportInstall } from './output.js';
import { installAll, planSkillConflicts } from '../installer/installAll.js';
import { conflictingSkills } from '../installer/installTeam.js';
import { checkInstallPath } from '../installer/installPaths.js';
import { HARNESS_LAYOUTS, isHarness, type Harness } from '../installer/harness.js';
import { availableModels, detectConfigProviders, detectEnvProviders } from '../installer/model-catalog.js';
import { migratePlannerConfig, resolveDefault } from '../installer/defaults.js';
import { readJevSettings } from '../installer/jev.js';
import { loadPersonalRulesFile, readPersonalInstructions } from '../installer/personalInstructions.js';
import { planVscodeSettings } from '../installer/vscodeSettings.js';
import { createInitialState } from '../tui/state.js';
import { AGENT_ORDER } from '../tui/state.js';
import { currentCaps, interactiveBlockers, runInstallerApp } from '../tui/run.js';
import type { TeamConfig } from '../types.js';

/** Bounded sync discovery for --defaults only (no mounted app to freeze). Never runs auth export. */
function defaultsModels(harness: string): string[] {
  if (harness !== 'opencode') return [];
  const run = (args: string[]): string => {
    try {
      return execFileSync('opencode', args, { encoding: 'utf8', timeout: 15000 });
    } catch {
      return '';
    }
  };
  return availableModels(run(['auth', 'list']), run(['models']), [...detectEnvProviders(), ...detectConfigProviders()]);
}

function savedConfig(target: string, harness: keyof typeof HARNESS_LAYOUTS): TeamConfig {
  const configPath = join(target, HARNESS_LAYOUTS[harness].config);
  checkInstallPath(target, configPath);
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, 'utf8')) as TeamConfig;
}

/** Install-time guard for the confirmed single target: it must still be a
 * readable real directory (never a symlink/file). Throws before any write. */
function checkTargetReady(dir: string): void {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    throw new Error(`Selected target is not accessible: ${dir} (${error instanceof Error ? error.message : 'unreadable'}). No files written.`);
  }
  if (stat.isSymbolicLink()) throw new Error(`Selected target is a symlink: ${dir}. Rerun and choose the real directory. No files written.`);
  if (!stat.isDirectory()) throw new Error(`Selected target is not a directory: ${dir}. Rerun and choose an existing folder. No files written.`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log(USAGE + `\n\nbuild ${readBuildInfo(resolvePackageRoot(import.meta.url)).tag}`);
    return;
  }
  if (args.harnessName && !isHarness(args.harnessName)) {
    console.error(`Unknown harness: ${args.harnessName}\n` + USAGE);
    process.exitCode = 2;
    return;
  }

  const target = process.cwd();
  const packageRoot = resolvePackageRoot(import.meta.url);
  const { definitionsDir, skillDir } = installerPaths(packageRoot);
  const build = readBuildInfo(packageRoot);
  const harness = args.harnessName && isHarness(args.harnessName) ? args.harnessName : 'opencode';

  let savedRules = readPersonalInstructions(target, harness);
  if (args.rulesFlag) savedRules = loadPersonalRulesFile(resolve(args.rulesFlag));
  if (args.clearRules) savedRules = '';
  const savedJev = harness === 'opencode' ? readJevSettings() : { enabled: false };
  const jevRequested = args.jev ?? savedJev.enabled;

  if (args.defaults) {
    const models = defaultsModels(harness);
    const config: TeamConfig = {};
    const overwrite: Record<string, boolean> = {};
    for (const name of AGENT_ORDER) {
      const choice = harness === 'opencode' ? resolveDefault(name, models) : undefined;
      if (choice) config[name] = choice;
      overwrite[name] = true;
    }
    console.log(`Default configuration (build ${build.tag}; unset models inherit):`);
    for (const name of AGENT_ORDER) {
      const choice = config[name];
      console.log(`  ${name}: ${choice?.model ?? 'unset'}${choice?.reasoningEffort ? ` @ ${choice.reasoningEffort}` : ''}`);
    }
    console.log();
    if (harness === 'opencode' && !config.ux?.model) {
      console.log('No recommended Sol model is available for UX. An unset UX model inherits the current model; select a suitable model explicitly before running design work.');
    }
    const plan = {
      options: { definitionsDir, skillDir, config, targetDir: target, overwrite, harness, replaceSkills: args.replaceSkills },
      instructions: savedRules,
      jevRequested: harness === 'opencode' ? jevRequested : false,
    };
    const conflicts = conflictingSkills(plan.options);
    if (conflicts.length && !args.replaceSkills) {
      throw new Error(`Adopt/replace unowned skill folders: ${conflicts.join(', ')}? Rerun with --replace-skills to authorize; no files written.`);
    }
    const result = installAll(plan);
    reportInstall(result, harness, build);
    return;
  }

  const blocker = interactiveBlockers(currentCaps());
  if (blocker) {
    console.error(blocker + '\n' + USAGE);
    process.exitCode = 2;
    return;
  }
  // Refuse tiny viewports before the alternate screen is ever entered.
  // A zero/unknown size is not a small terminal (Ink falls back); only a
  // known small viewport refuses startup. Mid-session shrinks keep state.
  const small = (value: number | undefined, minimum: number): boolean =>
    typeof value === 'number' && value > 0 && value < minimum;
  const stdoutColumns = process.stdout.columns;
  const stdoutRows = process.stdout.rows;
  if (small(stdoutColumns, 40) || small(stdoutRows, 8)) {
    console.error(`Terminal too small (${stdoutColumns ?? '?'}x${stdoutRows ?? '?'}; need at least 40x8). Enlarge the terminal or rerun with --defaults for a noninteractive single-directory install.\n` + USAGE);
    process.exitCode = 2;
    return;
  }

  const existing = migratePlannerConfig(savedConfig(target, harness));
  const preflightOptions = { definitionsDir, skillDir, config: {}, targetDir: target, overwrite: {}, harness };
  const initial = createInitialState({
    targetDir: target,
    harness,
    config: existing,
    overwrite: {},
    personalRules: savedRules,
    jevRequested: harness === 'opencode' ? jevRequested : false,
    skillConflicts: conflictingSkills(preflightOptions),
    vscodeKept: planVscodeSettings(target).body === null,
  });
  if (args.replaceSkills) initial.adoptSkills = true;
  if (args.jev !== undefined) initial.jevTouched = true;

  // Read-only refresh for interactive target/harness changes: each target
  // owns its saved model choices, conflicts and editor status. Personal
  // instructions stay user/harness-scoped and are never reloaded per target. Throws an actionable message so the picker can recover with
  // the committed target untouched; never writes.
  const loadRefresh = (dir: string, next: Harness) => {
    let config: TeamConfig;
    try {
      config = migratePlannerConfig(savedConfig(dir, next));
    } catch (error) {
      throw new Error(`Cannot load saved configuration from ${dir}: ${error instanceof Error ? error.message : 'invalid'}. The committed target is unchanged.`);
    }
    return {
      config,
      skillConflicts: conflictingSkills({ definitionsDir, skillDir, config: {}, targetDir: dir, overwrite: {}, harness: next }),
      vscodeKept: planVscodeSettings(dir).body === null,
    };
  };

  // Writes run INSIDE the mounted shell (truthful progress, signal-safe
  // write window); the terminal is restored before durable console output.
  // The confirmed session target is authoritative: no project write may land
  // on the invocation directory when another target was chosen.
  const outcome = await runInstallerApp({
    initial,
    loadRefresh,
    onInstall: (state) => {
      const installTarget = state.targetDir;
      checkTargetReady(installTarget);
      // Resolve personal instructions for the finally selected harness.
      const rules = state.rulesTouched
        ? state.personalRules
        : readPersonalInstructions(installTarget, state.harness);
      const plan = {
        options: {
          definitionsDir,
          skillDir,
          config: state.config,
          targetDir: installTarget,
          overwrite: state.overwrite,
          harness: state.harness,
          replaceSkills: args.replaceSkills || state.adoptSkills,
        },
        instructions: rules,
        jevRequested: state.harness === 'opencode' ?
          (state.jevTouched ? Boolean(state.jevRequested) : readJevSettings().enabled) : false,
      };
      const conflicts = planSkillConflicts(plan);
      if (conflicts.length && !plan.options.replaceSkills) {
        throw new Error(`Unowned skill folders need explicit adoption: ${conflicts.join(', ')}. Rerun with --replace-skills; no files written.`);
      }
      return installAll(plan);
    },
  });
  if (outcome.type === 'quit') {
    if (outcome.interrupted) {
      console.error(`Quit during write — ${outcome.state.targetDir} may be partially written. Rerun setup to complete or repair the installation.`);
      process.exitCode = 1;
      return;
    }
    console.log('Cancelled — no files written.');
    return;
  }
  if (outcome.type === 'install-error') {
    console.error(`Installation failed: ${outcome.error}`);
    process.exitCode = 1;
    return;
  }
  reportInstall(outcome.installResult, outcome.state.harness, build);
}
