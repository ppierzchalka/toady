# Toady

Explore an idea with **Analyst**. Hand ready tasks to **Lead** for implementation and independent review.

**Toady** is a reusable personal toolkit: eight agent roles and twelve skills, installed per repository for **OpenCode, Claude Code, Codex, Antigravity or GitHub Copilot**. Autonomous execution requires native multi-agent support in your harness.

## Install

Requires Node.js 22.19+ and npm.

```sh
cd your-project
npx -y https://github.com/ppierzchalka/toady/releases/download/current/installer-current.tgz
```

The interactive setup walks **installation directory → agents and models → personal instructions → review and install**; files are written only after you confirm. Personal instructions contain only your rules, without a voice/persona mode. Noninteractive flags, harness selection and the `install-team` alias form live in one place: [Installation options →](docs/team-configuration.md#installation-options).

**Local development** (for working on the toolkit itself):

```sh
git clone https://github.com/ppierzchalka/toady.git
cd toady
npm install
npm run setup
```

[Installation and model settings →](docs/team-configuration.md)

## From idea to ready task

Work with **Analyst**. Start at the point that fits what you already know.

| Skill | Result |
| --- | --- |
| `project-setup` | Documentation paths, task tracker, statuses and definition of done. Run once; revisit when conventions change. |
| `wayfinder` | Product or feature direction: brief, shared vocabulary and significant decisions. Resume across sessions. |
| `slice` | Manageable tasks with dependencies, marked **ready-for-refinement**. |
| `refine` | One task with accepted behavior, scope, criteria and verification, marked **ready-to-implement**. |
| `plan` | Optional technical execution detail on the existing task. |

Domain modeling happens during the conversation: Analyst clarifies ambiguous terms, checks relationships against scenarios and code, and records accepted definitions and rules in the configured documents. ADRs capture decisions worth preserving.

A small change can start at `refine`. A ready task can go straight to Lead. You decide how long discovery lasts.

## From ready task to working change

Use **Lead** with `autonomous-implement` and one or more task references. For example:

> Implement tasks 12 and 15 locally. Use Developer and Reviewer. Keep the work in this checkout.

Lead proposes the team, task grouping, dependency order and checks. **Developer + independent Reviewer** is the default; specialists join when their input has value. Related tasks can share a bounded execution context while retaining separate criteria and outcomes. Concurrent writable work uses isolated worktrees.

Choose **local changes, separate PRs, stacked PRs or one consolidated PR** before execution. Stacking and consolidation are also available later on request. Merge and deployment require explicit authorization.

## Consult a specialist

Agents define responsibility and runtime settings; skills describe how to do the work. You can consult any specialist directly, without Lead or a pipeline.

| Agent | Skill | Focus |
| --- | --- | --- |
| Architect | [`architecture-assess`](skills/architecture-assess/SKILL.md) | Boundaries, interfaces and design tradeoffs |
| Security | [`security-assess`](skills/security-assess/SKILL.md) | Threats and trust boundaries |
| UX | [`interface-assess`](skills/interface-assess/SKILL.md) | Interface behavior and interactions |
| Tester | [`test-design`](skills/test-design/SKILL.md) | Cases and verification; read-only by default |
| Developer | [`implement-task`](skills/implement-task/SKILL.md) | Code, tests and checks |
| Reviewer | [`review-change`](skills/review-change/SKILL.md) | Requirements, code quality and evidence |

## Details and validation

[Configuration](docs/team-configuration.md) · [Workflow scenarios](docs/prompt-evaluation.md) · [Design decisions](docs/adr/0004-skills-and-execution-packets.md)

```sh
npm test
npm run typecheck
npm run build
```

Focused selectors (`test:fast`, `test:rendered`, `test:release`) are defined in `package.json` and exercised through the [workflow validation](docs/prompt-evaluation.md) protocol.

### Optional Go Jev decision gates

The installer can enable Jev as an **optional** evidence-alignment check at readiness, plan handover and outcome completion. It is **off by default**, never uses any non-Go provider, and can be disabled in the Personal instructions screen or with `--no-jev` during noninteractive setup. `--jev` requests activation, which succeeds only if an authenticated OpenCode Go Jev model exists **and** the native model capability check succeeds. Current OpenCode Go offerings may not include Jev; in that case the feature remains disabled without blocking ordinary work. There is no OpenCode Zen fallback. See [team configuration](docs/team-configuration.md#optional-jev-decision-gates-opencode-go-only).
