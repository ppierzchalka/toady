import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { checkInstallPath, checkInstallTree, checkInstallFile, checkInstallDirectory } from './installPaths.js';
import { planLegacyCleanup, removeLegacyDefinitions } from './legacyAgents.js';
import { applyGitignoreEntries, managedGitignoreEntries } from './gitignore.js';
import type { InstallOptions, InstallResult, TeamConfig } from '../types.js';
import { HARNESS_LAYOUTS, renderAgent, updateTomlChoice, applyHarnessChoice, reconcileAntigravityTools, type Harness } from './harness.js';


export function parseAgentFile(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  return {
    frontmatter: (parse(match[1]) as Record<string, unknown>) ?? {},
    body: match[2],
  };
}

export function serializeAgentFile(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n${body}`;
}

function writeConfig(targetDir: string, config: TeamConfig, harness: Harness): string {
  const dir = dirname(join(targetDir, HARNESS_LAYOUTS[harness].config));
  mkdirSync(dir, { recursive: true });
  const configPath = join(targetDir, HARNESS_LAYOUTS[harness].config);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

export const SHIPPED_SKILLS = ['autonomous-implement', 'wayfinder', 'slice', 'refine', 'plan', 'project-setup', 'architecture-assess', 'security-assess', 'interface-assess', 'test-design', 'implement-task', 'review-change', 'decision-gates'] as const;
/** Current product owner marker; the prior namespace is recognized as owned for safe upgrades. */
export const SKILL_OWNER = 'toady';
const LEGACY_SKILL_OWNER = 'spec-driven-scrum-team';
const ownerFile = '.team-owner.json';

function skillSources(skillDir: string): string[] {
  return SHIPPED_SKILLS.map(name => name === 'autonomous-implement' ? skillDir : join(dirname(skillDir), name))
    .filter(path => existsSync(join(path, 'SKILL.md')));
}

export function conflictingSkills(options: InstallOptions): string[] {
  const harness = options.harness ?? 'opencode';
  return skillSources(options.skillDir).filter(source => {
    const name = source.split(/[\\/]/).pop()!;
    const dest = join(options.targetDir, HARNESS_LAYOUTS[harness].skills, name);
    checkInstallTree(options.targetDir, dest);
    if (!existsSync(dest)) return false;
    const marker = join(dest, ownerFile);
    if (existsSync(marker)) {
      const owner = JSON.parse(readFileSync(marker, 'utf8'));
      if (owner.owner === SKILL_OWNER || owner.owner === LEGACY_SKILL_OWNER) return false;
    }
    // Unmarked installs (including legacy versions) need explicit adoption.
    return true;
  }).map(source => source.split(/[\\/]/).pop()!);
}

function copySkillFiles(source: string, dest: string, root: string): void {
  checkInstallPath(root, dest);
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Skill source must contain only regular files/directories, not symlinks');
    const output = join(dest, entry.name);
    checkInstallPath(root, output);
    if (entry.isDirectory()) copySkillFiles(join(source, entry.name), output, root);
    else writeFileSync(output, readFileSync(join(source, entry.name)));
  }
}

/** Read-only validation of the entire team install before personal instruction or team writes. */
export function preflightTeam(options: InstallOptions): void {
  const harness = options.harness ?? 'opencode';
  planLegacyCleanup(options);
  if (!existsSync(join(options.skillDir, 'SKILL.md'))) throw new Error('Missing autonomous-implement skill source');
  for (const choice of Object.values(options.config)) applyHarnessChoice({}, choice, harness);
  for (const path of [HARNESS_LAYOUTS[harness].agents, HARNESS_LAYOUTS[harness].skills, HARNESS_LAYOUTS[harness].config]) {
    checkInstallPath(options.targetDir, join(options.targetDir, path));
  }
  checkInstallTree(options.targetDir, join(options.targetDir, HARNESS_LAYOUTS[harness].agents));
  const saved = join(options.targetDir, HARNESS_LAYOUTS[harness].config);
  checkInstallFile(options.targetDir, saved);
  if (existsSync(saved)) JSON.parse(readFileSync(saved, 'utf8'));
  const gitignorePath = join(options.targetDir, '.gitignore');
  checkInstallFile(options.targetDir, gitignorePath);
  if (existsSync(gitignorePath)) applyGitignoreEntries(readFileSync(gitignorePath, 'utf8'), managedGitignoreEntries(harness));
  for (const name of readdirSync(options.definitionsDir).filter(name => name.endsWith('.md'))) {
    const source = parseAgentFile(readFileSync(join(options.definitionsDir, name), 'utf8'));
    renderAgent(name.slice(0, -3), String(source.frontmatter.description ?? name), source.body, options.config[name.slice(0, -3)], harness);
    const dest = join(options.targetDir, HARNESS_LAYOUTS[harness].agents, name.slice(0, -3) + HARNESS_LAYOUTS[harness].extension);
    checkInstallFile(options.targetDir, dest);
    if (existsSync(dest)) {
      if (harness === 'codex') parseToml(readFileSync(dest, 'utf8'));
      else parseAgentFile(readFileSync(dest, 'utf8'));
    }
  }
  function inspectSource(path: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Skill source must contain only regular files/directories, not symlinks');
      if (entry.isDirectory()) inspectSource(join(path, entry.name));
    }
  }
  for (const source of skillSources(options.skillDir)) {
    inspectSource(source);
    const dest = join(options.targetDir, HARNESS_LAYOUTS[harness].skills, source.split(/[\\/]/).pop()!);
    checkInstallTree(options.targetDir, dest);
    checkInstallDirectory(options.targetDir, dest);
    checkInstallFile(options.targetDir, join(dest, ownerFile));
    // Existing destination types must also match every planned source write.
    function inspectDestination(src: string, output: string): void {
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        const target = join(output, entry.name);
        checkInstallPath(options.targetDir, target);
        if (entry.isDirectory()) checkInstallDirectory(options.targetDir, target);
        else checkInstallFile(options.targetDir, target);
        if (entry.isDirectory()) inspectDestination(join(src, entry.name), target);
      }
    }
    inspectDestination(source, dest);
  }
  const rolesDir = join(options.targetDir, HARNESS_LAYOUTS[harness].skills, 'autonomous-implement/references/roles');
  checkInstallDirectory(options.targetDir, rolesDir);
  for (const name of readdirSync(options.definitionsDir).filter(name => name.endsWith('.md'))) {
    checkInstallFile(options.targetDir, join(rolesDir, name));
  }
  checkInstallFile(options.targetDir, join(rolesDir, 'runtime.json'));
  const conflicts = conflictingSkills(options);
  if (conflicts.length && !options.replaceSkills) throw new Error('Unowned skill name conflicts: ' + conflicts.join(', ') + '. Use --replace-skills only to explicitly adopt/replace these folders.');
}

function writeAgent(
  definitionsDir: string,
  name: string,
  targetDir: string,
  choice: { model?: string; reasoningEffort?: string } | undefined,
  harness: Harness,
  previousChoice?: TeamConfig[string],
): string {
  const source = join(definitionsDir, `${name}.md`);
  const agent = parseAgentFile(readFileSync(source, 'utf8'));
  const destDir = join(targetDir, HARNESS_LAYOUTS[harness].agents);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, name + HARNESS_LAYOUTS[harness].extension);
  let content = renderAgent(name, String(agent.frontmatter.description ?? name), agent.body, choice, harness);
  if (existsSync(dest)) {
    const original = readFileSync(dest, 'utf8');
    const existing = harness === 'codex' ? parseToml(original) : parseAgentFile(original).frontmatter;
    const rendered = harness === 'codex' ? parseToml(content) : parseAgentFile(content).frontmatter;
    // Retain operator-defined native controls/integrations while refreshing procedures.
    for (const key of ['tools', 'disallowedTools', 'permission', 'permissionMode', 'sandbox_mode', 'mcpServers', 'hooks']) {
      if (existing[key] !== undefined) rendered[key] = existing[key];
    }
    if (harness === 'antigravity') reconcileAntigravityTools(rendered, previousChoice, choice);
    applyHarnessChoice(rendered, choice, harness);
    content = harness === 'codex' ? stringifyToml(rendered as Parameters<typeof stringifyToml>[0]) : serializeAgentFile(rendered, parseAgentFile(content).body);
  }
  writeFileSync(dest, content);
  return dest;
}

function updateAgentInPlace(targetDir: string, name: string, choice: TeamConfig[string] | undefined, harness: Harness, previousChoice?: TeamConfig[string]): string {
  const dest = join(targetDir, HARNESS_LAYOUTS[harness].agents, name + HARNESS_LAYOUTS[harness].extension);
  const content = readFileSync(dest, 'utf8');
  if (harness === 'codex') writeFileSync(dest, updateTomlChoice(content, choice));
  else {
    const agent = parseAgentFile(content);
    if (harness === 'antigravity') reconcileAntigravityTools(agent.frontmatter, previousChoice, choice);
    applyHarnessChoice(agent.frontmatter, choice, harness);
    writeFileSync(dest, serializeAgentFile(agent.frontmatter, agent.body));
  }
  return dest;
}

export function installTeam(options: InstallOptions): InstallResult {
  preflightTeam(options);
  const { definitionsDir, skillDir, config, targetDir, overwrite = {}, harness = 'opencode' } = options;
  // Validate all configured tiers before any install writes.
  if (harness === 'antigravity') {
    for (const choice of Object.values(config)) applyHarnessChoice({}, choice, harness);
  }
  const written: string[] = [];
  const preserved: string[] = [];
  const savedConfig = join(targetDir, HARNESS_LAYOUTS[harness].config);
  const previousConfig: TeamConfig = existsSync(savedConfig) ? JSON.parse(readFileSync(savedConfig, 'utf8')) as TeamConfig : {};

  const names = readdirSync(definitionsDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.slice(0, -3))
    .sort();

  for (const name of names) {
    const choice = config[name];
    if (overwrite[name] === false && existsSync(join(targetDir, HARNESS_LAYOUTS[harness].agents, name + HARNESS_LAYOUTS[harness].extension))) {
      preserved.push(updateAgentInPlace(targetDir, name, choice, harness, previousConfig[name]));
    } else {
      written.push(writeAgent(definitionsDir, name, targetDir, choice, harness, previousConfig[name]));
    }
  }

  const skillPaths = skillSources(skillDir).map(source => {
    const dest = join(targetDir, HARNESS_LAYOUTS[harness].skills, source.split(/[\\/]/).pop()!);
    copySkillFiles(source, dest, targetDir);
    writeFileSync(join(dest, ownerFile), JSON.stringify({ owner: SKILL_OWNER }) + '\n');
    return join(dest, 'SKILL.md');
  });
  const skillPath = skillPaths[0];
  const rolesDir = join(targetDir, HARNESS_LAYOUTS[harness].skills, 'autonomous-implement/references/roles');
  mkdirSync(rolesDir, { recursive: true });
  for (const name of names) {
    const native = readFileSync(join(targetDir, HARNESS_LAYOUTS[harness].agents, name + HARNESS_LAYOUTS[harness].extension), 'utf8');
    const body = harness === 'codex' ? String(parseToml(native).developer_instructions ?? '') : parseAgentFile(native).body;
    writeFileSync(join(rolesDir, name + '.md'), body);
  }
  const runtimeAgents = Object.fromEntries(names.map(name => {
    const nativeDefinition = HARNESS_LAYOUTS[harness].agents + '/' + name + HARNESS_LAYOUTS[harness].extension;
    const source = readFileSync(join(targetDir, nativeDefinition), 'utf8');
    const metadata = harness === 'codex' ? parseToml(source) : parseAgentFile(source).frontmatter;
    return [name, { nativeDefinition, model: metadata.model, reasoningEffort: metadata.model_reasoning_effort ?? metadata.reasoningEffort }];
  }));
  writeFileSync(join(rolesDir, 'runtime.json'), JSON.stringify({ harness, agents: runtimeAgents }, null, 2) + '\n');
  const configPath = writeConfig(targetDir, config, harness);
  const gitignorePath = join(targetDir, '.gitignore');
  const existingGitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  writeFileSync(gitignorePath, applyGitignoreEntries(existingGitignore, managedGitignoreEntries(harness)));

  return { written, preserved, configPath, gitignorePath, skillPath, skillPaths, ...removeLegacyDefinitions(options) };
}
