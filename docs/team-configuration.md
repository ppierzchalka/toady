# Installation and team configuration

Run the [release launcher](../README.md#install) in the repository you want to
configure. A native keyboard-first full-screen setup walks four steps:
**installation directory → agents and models → personal instructions → review
and install**. Navigate with **↑/↓** (**Home**, **End**, **PgUp**/**PgDn** in
long lists), activate with **Enter**, **Space** toggles checkboxes (and types
in inputs), **Tab** moves between search and list, **Esc** opens a safe Quit
dialog from anywhere before anything is written. No mouse. Files are written
only after selecting **Install** in the final summary. Noninteractive use and
all installer flags are covered under
[Installation options](#installation-options).

## Single installation directory

One interactive run installs into exactly one target folder. The directory
screen defaults to the absolute invocation directory and offers a native
folder picker for another existing directory. Browsing folders never changes
the target or writes files: only an explicit **Use this folder** action
confirms another target, while **Cancel** keeps the prior target. Confirming
another target loads that folder's saved team configuration (with explicit
consent when it would discard session agent edits); reselecting the same
target keeps committed session choices. Editors offer explicit Cancel rows and
Back navigation: cancelling a draft discards only the draft, and Back retains
committed choices. Passing a target path fails with usage instead of
installing elsewhere.

The picked target must exist, be a real directory (no symlinks) and be
readable; invalid targets are rejected recoverably in the picker, and no
folder is ever created for you.

Every write scope — team files, personal instructions and editor settings — is
preflighted before the first write. Unowned skill collisions are listed for one
in-shell adoption decision. This is not a filesystem transaction: disk
errors/concurrent changes may leave the target partially written, reported
truthfully.

Setup appends a managed `.gitignore` block that ignores the installed agent,
skills and config paths, and configures `.vscode/settings.json` so Ctrl+P
reaches applications in the VS Code integrated terminal; all other rules and
unrelated harness folders stay untouched. Recognized unchanged legacy Planner
definitions are removed on update.

In non-TTY/raw-mode-unavailable/`TERM=dumb` environments interactive
invocation exits with usage and no writes; it never silently selects defaults.

## Installation options

All remote installs use the single canonical route (no npm publish, no clone):

```sh
cd your-project
npx -y https://github.com/ppierzchalka/toady/releases/download/current/installer-current.tgz
```

Every launch resolves the newest successfully verified master build and
verifies its exact tarball checksum before executing it; lookup or verification
failures abort before anything is written.

npx infers the canonical `toady` entry from the tarball, so no bin name is
needed. Append installer flags directly after the URL (no `--` separator —
the installer rejects it as an unknown flag):

```sh
npx -y https://github.com/ppierzchalka/toady/releases/download/current/installer-current.tgz --harness=opencode --defaults --additional-rules=/path/to/rules.md
```

Available installer flags:

| Flag | Effect |
| --- | --- |
| `--harness=<name>` | `opencode` \| `claude-code` \| `codex` \| `antigravity` \| `copilot`; optional — omitted means `opencode` (including with `--defaults`); chosen interactively otherwise |
| `--defaults`, `-d` | Noninteractive install with default models; always installs into the current directory |
| `--additional-rules=<file>` | Load personal instructions; relative paths resolve against the invocation directory; regular Markdown/text files up to 64 KiB |
| `--clear-additional-rules` | Clear personal instructions |
| `--replace-skills` | Adopt/replace unowned shipped skill folders without prompting (noninteractive collision handling) |
| `--help`, `-h` | Show help (verifies freshness first, like every other launch) |

The `install-team` alias runs the same entry with identical arguments and
results, but npx positional inference only resolves the canonical `toady`
bin — invoking the alias needs the explicit `--package` form:

```sh
npx --yes --package=https://github.com/ppierzchalka/toady/releases/download/current/installer-current.tgz install-team --harness=opencode --defaults
```

From a target directory, `--defaults` installs noninteractively into the
current directory without opening the setup; model defaults apply, while the
user profile retains its saved instructions unless corresponding flags
explicitly override them.

A repository checkout (`git clone` + `npm run setup`) is the toolkit
development workflow, not a competing install route: `npm run setup`
configures the checkout itself, while project installs always go through the
release launcher above.

## Installation ownership and paths

Validate all team destinations and personal-instructions changes before the first installation write. Reject symlink roots/children, dangling links, escaping paths, incompatible file types and malformed known configuration. Recheck skill paths during copying. Source skills must use regular files/directories. These checks prevent ordinary linked-destination writes; this is not an OS sandbox or a defense against a hostile process changing paths concurrently.

Each installed skill has a .team-owner.json marker. New installs write `{"owner":"toady"}`; markers reading `spec-driven-scrum-team` are recognized as owned without an adoption prompt and refreshed to the current marker on reinstall. Existing unmarked folders (including previous versions and external packages with the same name) require explicit adoption. Interactive setup asks once for listed collisions; noninteractive setup stops unless you supply `--replace-skills`. Review the listed folders first: adoption authorizes overwriting their shipped paths. Other skills are untouched. Custom contents within owned shipped paths can be replaced during refresh; back up intentional skill edits first. No folder deletion is automatic.

Refresh canonical agent instructions with overwrite=yes; overwrite=no retains edited prompts while updating model choices. Operator-defined native permissions, tools, hooks and MCP integrations survive instruction refresh. Shared procedures always refresh. Legacy planner settings migrate to Analyst during interactive configuration; after successful installation, known unchanged retired `planner` definitions and their portable role copy are removed for the selected harness. Model/effort preferences do not prevent cleanup; edited instructions, permissions, tools, integrations, unknown metadata or malformed files are preserved and reported for manual migration. Cleanup never scans unrelated names or other harness folders.

Preflight is read-only validation, not a filesystem transaction. Disk errors or concurrent modifications after validation can still cause partial writes. Do not run the installer against a concurrently mutated checkout.

## Selected-harness layout

| Harness | Agents | Skills | Model default |
| --- | --- | --- | --- |
| OpenCode | .opencode/agents/*.md | .opencode/skills/ | Existing agreed routing matrix below |
| Claude Code | .claude/agents/*.md | .claude/skills/ | Inherit |
| Codex | .codex/agents/*.toml | .agents/skills/ | Inherit |
| Antigravity | .agents/agents/*.md | .agents/skills/ | Inherit; optional flash/pro tiers |
| Copilot | .github/agents/*.agent.md | .github/skills/ | Inherit |

For every harness the installer adds a managed `.gitignore` block (delimited by `# toady:gitignore:start`/`end`) with the agents directory, skills directory and config file from the selected layout — for OpenCode `.opencode/agents/`, `.opencode/skills/`, `.opencode/team.config.json`; for Codex `.codex/agents/`, `.agents/skills/`, `.codex/team.config.json`. The block is created when `<target>/.gitignore` is missing, replaced on reinstall, and never rewrites or duplicates other user rules. Blocks written under the prior `# spec-driven-scrum-team:gitignore:` namespace are recognized without an adoption prompt and consolidated into the single current block, preserving surrounding content; repeated reinstalls are idempotent. Malformed or duplicated markers from either namespace fail preflight without mutation.

CLI/GUI discovery depends on version, project trust and native multi-agent access. The installer writes formats; it does not enable runtime features. Portable role bodies and references/roles/runtime.json preserve the selected model/effort and native-definition path for general-subagent dispatch. Model text in a prompt is not a runtime override: unavailable explicit selections require a capability decision rather than silent inheritance.

Fresh Reviewer defaults use OpenCode edit-deny, Claude denied Write/Edit/NotebookEdit and Codex read-only sandbox. Existing native controls take precedence on reinstall. Removing edit tools alone does not stop shell writes; enforce meaningful shell/network limits in the runtime. Architecture/Security/UX retain possible authorized document persistence and prompt ownership boundaries. Antigravity integrations can be added in native configuration; defaults are not a universal MCP/browser setup.

## Procedures and team

Eight named agents remain available: Analyst, Lead, Architect, Security, UX, Tester, Developer, Reviewer. Twelve skills contain the methods:

| Activity | Skill |
| --- | --- |
| Conventions / direction / decomposition / refinement / optional technical plan | project-setup / wayfinder / slice / refine / plan |
| Execution coordination | autonomous-implement |
| Structural decision / trust-boundary assessment / interaction contract | architecture-assess / security-assess / interface-assess |
| Independent cases / implementation / independent review | test-design / implement-task / review-change |

No procedure depends on external Matt Pocock skills being installed. Existing TDD/debugging skills can be used when relevant; do not invoke two procedures for the same work automatically. Agents load only assigned procedures and absent role/core instructions. Standalone consultation needs no Ticket, Lead or pipeline.

Wayfinder/Refine support unlimited resumable sessions, at most three consequential questions per turn, and a small Current state section in the owning artifact. Long exploration is valid. Slice creates real tasks ready-for-refinement; Refine updates the same IDs until ready-to-implement. Plan remains optional. Existing analysis skills also select questions by decision prerequisites, recommend options, actively challenge domain terms/relationships against code and concrete scenarios, and persist settled vocabulary inline. ADRs require meaningful reversal cost, a future need for rationale and a genuine tradeoff unless explicitly requested. Refine checks remaining Developer guesses and behavioral verification seams before accepted readiness. These are integrated disciplines, not additional skills, sessions or mandatory reports.

## Execution choices

Setup optionally stores chosen execution preferences in docs/agents/execution.md or the existing equivalent. They are separate from team.config.json model settings. Precedence: current invocation, explicit session choices, project preferences, lean recommendations. Defaults are not permission to publish/deploy.

Lead classifies scope/uncertainty/risk and recommends lean Developer+Reviewer. Extra specialists need concrete value. Tester is test-design/read-only by default when enabled; explicit test-author assigns test ownership separately. Developer owns tests otherwise. Optional independent candidates use distinct lenses, evidence and a bounded evaluation; consensus is not proof.

Group bounded related tasks into an agreed execution packet when context, permissions, checks and delivery align. One Developer and independent Reviewer can cover the packet, with separate task IDs/criteria/statuses and interaction checks. Do not group away separate PR diffs. Split unrelated/large/risky work or conflicting ownership. Required intermediate dependency gates still apply; same-checkout sequential tasks may use verified local state, while cross-worktree dependencies require verified usable commits and integration permission.

One local packet uses current checkout. Concurrent writable packets use isolated worktrees; concurrency counts workers, not tasks. One Lead manages the frontier without wave-wide waits or Lead-per-task by default.

Before execution Lead asks for local/separate/stacked/consolidated delivery unless already explicitly chosen. Stack/consolidate remain available later on demand; no automatic PR closure, deletion, force push, merge or deployment. Effective contract is recorded once. Detailed run-contract/proposal/worktree references load only when relevant.

Default review budget: two total passes per agreed review unit, stopping on approval. Delta rereview reuses reliable unchanged evidence. Remaining findings or missing gates at the limit are reported with the next option; unreviewed fixes are not approved. Integration invalidates relevant evidence and requires assembled checks/review.

Optional usage reporting accepts sanitized actual aggregates, tracks coverage/unknowns and compares cost per correctly delivered result. The local summarize-usage script does not fetch billing or export conversations. Cached/reasoning fields may overlap provider totals. Hard monetary limits require runtime enforcement.

## OpenCode provider-balanced model defaults

The default allocation puts OpenAI capacity into planning, architecture, and UX; OpenCode Go handles implementation/tests, and OpenCode Go/Zen handles review/security. Effort is selected per role rather than raised uniformly. It is a routing policy, not a benchmark or a guarantee about a model's capabilities, usage limits, or billing.

| Agent | Preferred model | Effort | Workload rationale |
| --- | --- | --- | --- |
| Analyst | `openai/gpt-6.1-sol` | medium | Direction, bounded refinement, specs, Tickets and tracker conventions |
| Lead | `openai/gpt-6.1-sol` | medium | Execution scheduling, run configuration and coordination |
| Architect | `openai/gpt-6-luna` | xhigh | Architecture, invariants, and consequential tradeoffs |
| Security | `opencode-go/deepseek-v4-pro` | high | Scoped trust-boundary assessment when enabled |
| UX | `openai/gpt-6.1-sol` | medium | Product-specific visual/interaction decisions and rendered contract review |
| Tester | `opencode-go/muse-spark-1.3-contributor` | medium | Tests against defined criteria/design notes |
| Developer | `opencode-go/muse-spark-1.3-contributor` | medium | Implement the defined architecture, behavior, and visual contract |
| Reviewer | `opencode-go/deepseek-v4-flash` | medium | Independent correctness/contract review and follow-ups |

Only models found in the installer's available list can be selected automatically. The ordered, exact-ID fallback lists live in `src/installer/defaults.ts`:

- Lead prefers Sol 6.1, then Sol 6, then Terra at medium effort. Architect prefers Luna 6/xhigh, then Luna 5.6/xhigh; neither falls back to Astra. The Luna variants were verified through `opencode models openai --verbose`.
- UX falls back only to `openai/gpt-6-sol`; no cheap thinking/execution model is silently selected for design. If neither Sol candidate is available, no UX default is set and the installer explains that unset means inheritance. Select a suitable model manually before enabling UX work.
- OpenCode Go reasoning models have Zen equivalents as fallbacks. Implementation/tests prefer the flat-rate OpenCode Go Muse Contributor, then the OpenCode free Muse Contributor, then appropriate OpenCode reasoning models. The metered Meta API Muse Contributor is intentionally not a default.
- Reviewer prefers plain DeepSeek V4 Flash through Go or Zen, then V4 Pro/medium if Flash is unavailable. Security prefers V4 Pro/high. Neither role nor Developer/Tester automatically falls back to OpenAI.
- Astra and unlisted fast/premium variants are manual choices, never automatic matches. Exact matching avoids accidentally selecting a different variant merely because its name contains a preferred ID.

**Apply these defaults to an existing install:** run setup, choose **Reset all to defaults** (or reset an individual agent), then continue through personal instructions and select **Install** in the final summary. Saved model choices are preserved during ordinary reconfiguration; changing the defaults does not silently replace them. A noninteractive reset uses `--defaults` from the target directory (see [Installation options](#installation-options)).

If a role has no available listed candidate, first-time/defaults installation leaves it unset (inheriting the current opencode model); an interactive reset keeps its existing choice. Check the resulting selections before running a quality-sensitive stage.

Only enabled roles consume work for a given run; the allocation changes naturally with your confirmed pipeline. When cheap/bounded work reveals unresolved architecture or design decisions, route them to the enabled decision owner or ask for reconfiguration before implementation guesses.

**Explicit upgrades:** for difficult bugs, disputed review findings, or a sensitive threat model that exceeds the current model's demonstrated capability, Lead can recommend a stronger model for that role and bounded task. Sol, Terra, or `openai/gpt-6-luna` are available choices in the checked catalog. Raising effort above the role's confirmed setting is also a separate, explicit user choice, not an automatic response to every failure. Record approved reconfiguration in the run contract and return to the normal defaults when the exception is finished.

## Personal instructions

The third installer step manages **user-authored instructions only**. There is no persona, role-playing voice, character mode or tone toggle. Select **Browse for a rules file**, **Enter a rules file path**, or **Clear additional rules**. Markdown and text files up to 64 KiB are accepted; contents are inserted verbatim as personal instructions (no generated coding defaults or stylistic instructions). The browser validates selected files and preserves the current rules when cancelled. Do not include credentials or secrets.

Personal instructions are **user- and harness-scoped**, applied to projects on this computer, not committed to repositories. Team agents and skills remain installed per project.

| Harness | Native user startup file |
| --- | --- |
| OpenCode | `~/.config/opencode/AGENTS.md` (managed instructions block) |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.override.md` when present, otherwise `~/.codex/AGENTS.md` |
| Copilot CLI | `~/.copilot/copilot-instructions.md` |
| Antigravity | `~/.gemini/GEMINI.md` |

OpenCode respects `XDG_CONFIG_HOME`; Claude Code respects `CLAUDE_CONFIG_DIR`; Codex respects `CODEX_HOME`. User instructions are placed within a managed `<!-- toady:instructions:start -->` / `<!-- toady:instructions:end -->` block, preserving unrelated content in the native file. The installer does not configure VS Code Copilot's separate personal instruction settings. Under OpenCode, global `AGENTS.md` is used rather than a config `instructions` entry.

**Migration from older releases:** when setup is run again for a harness, previous `<!-- toady:start -->` and `<!-- spec-driven-scrum-team:toady:start -->` blocks are removed from recognized native/project files. Old settings in `toady/persona.json`, `spec-driven-scrum-team/persona.json`, or `.opencode/toady.config.json` are read for their `projectRules`; the obsolete `enabled` voice flag is discarded. A single `toady/instructions.json` is written privately for the harness. Known generated persona files and their OpenCode `instructions` references are retired when recognized. Other startup instructions, provider configuration and project conventions remain untouched. No Git history is rewritten, so previously committed generated files must be cleaned separately.

**To apply or remove instructions:** use the interactive Personal instructions step, or pass `--additional-rules=<file>` / `--clear-additional-rules` with `--defaults`. Running setup with no imported rules still performs legacy cleanup. Relaunch the agent session after changing global instructions. Rules inside the prompt are guidance, not an authorization boundary: apply native least-privilege credentials and permissions for restricted services.

## Optional Jev decision gates (OpenCode Go only)

Jev validation is **off by default**. The Personal instructions screen has a `Jev decision gates (OpenCode Go only)` checkbox; `--jev` or `--no-jev` is available with `--defaults`. The option is inactive for Claude Code, Codex, Antigravity and Copilot. The option cannot be turned on in the TUI if OpenCode's authenticated Go model catalog does not contain `opencode-go/jev-*`.

Enabling Jev requires both an authenticated Go provider and a supported `opencode run --model opencode-go/jev-* --format json` capability test. Merely advertising a model never permits activation. A missing model, failed capability test, expired subscription or unsupported interface leaves the option **disabled**, without trying another provider. The installer does not use the Zen System One endpoint and does not ask for or export an API key. The private setting is stored in the user's OpenCode config under `toady/decision-gates.json`, not the repository; `--no-jev` disables it, and no settings are created for a never-enabled installation.

The installed `decision-gates` skill offers three advisory checkpoints: readiness, plan alignment and outcome completion. Its local runner independently rechecks OpenCode Go access for every call; no run occurs unless the setting is enabled. Runtime failure yields `unknown`/`skipped`, not approval. Required checks and human authorization are unchanged. The runner accepts only concise user-approved evidence, and uses a temporary owner-only file to attach that evidence to the native OpenCode process; never pass secrets or sensitive corporate material. Go API/model availability may change. The feature may remain unavailable even when you have an active Go subscription.

Official availability: [Go](https://docs.opencode.ai/docs/go/) lists the Go model catalog; [Zen Jev](https://docs.opencode.ai/docs/zen/#jev) is a separate paid API and is intentionally NOT used.
