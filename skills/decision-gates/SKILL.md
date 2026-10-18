---
name: decision-gates
description: Optional Jev System One outcome alignment checks at readiness, plan handover, and completion. Explicit personal-project consent only; never required for standard Toady.
---
# Decision Gates (strict opt-in)

This skill is INERT unless the exact project has a private consent profile with enabled=true and scope=personal. Work projects are always off. Do not infer consent from another project, installed skill, provider credentials, agent choice or model catalog. The installed runner enforces consent again and cannot silently call another provider.

## Activation
The installer requires explicit selection of **Personal project** and then a provider (Zen / TypeSafe / OpenRouter). Defaults to Work (no Jev). The installer probes the chosen provider's System One typed endpoint before enabling. Credentials are read only from the chosen provider's environment variable. No keys in project files or profiles. No provider fallback, no conversation-mode imitation.

Use the native project skill at:
- OpenCode: node .opencode/skills/decision-gates/scripts/judge.mjs <readiness|plan|outcome>
- Claude Code: node .claude/skills/decision-gates/scripts/judge.mjs <readiness|plan|outcome>
- Codex/Antigravity: node .agents/skills/decision-gates/scripts/judge.mjs <readiness|plan|outcome>
- Copilot: node .github/skills/decision-gates/scripts/judge.mjs <readiness|plan|outcome>

Execute it from the **exact project root** and supply a <=12 KiB JSON input on stdin. Before running, confirm the material is personal and approved for the selected external provider. Explicitly set TOADY_JEV_DISABLE=1 in environments that prohibit all external judgments.

Input JSON:
- goal: original or accepted user outcome (string)
- criteria: accepted criteria in compact strings (non-empty list)
- evidence: verifiable check outcomes and versions (non-empty list)
- proposedDecision: proposed stage transition (string)

Output JSON:
- status: pass | rework | escalate | unknown | skipped
- reason: fixed non-generative explanation (Jev returns typed choices, NOT free-text reasons)
- gate: input stage
- provider: only for valid decisions
- confidence: decision confidence if available

Jev judgments are advisory and cannot authorize changes to tasks, scope, acceptance, secrets, publication, merging, deployment or permissions.

## Checkpoints
- **Refine → Ready:** Are the accepted criteria enough to cover the goal? Analyst must still clarify unknowns with the user.
- **Lead → Execution:** Does the proposed plan cover scope, dependencies and risks within authorization? Do not bypass the run contract.
- **Reviewer/Lead → Done:** Do versioned tests and observations support the original result, not merely implementation claims?

One call per material revision by default, not one call per operation. Distinguish a factual failure from an unknown. On rework, examine the actual evidence rather than blindly doing everything a statistical classifier implies. On unknown or skipped, continue the ordinary non-Jev workflow without treating the gate as passed. No Jev call is required in work projects.

The runner applies immutable provider/endpoint mapping, short timeouts and response validation. It must never use chat completions as Jev, export credentials or submit the entire repository. The user can disable the feature in the installer, with --no-jev, or via TOADY_JEV_DISABLE=1; never reenable without fresh explicit consent.
