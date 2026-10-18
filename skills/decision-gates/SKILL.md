---
name: decision-gates
description: Optional evidence-alignment evaluation at readiness, plan handover and outcome completion. OpenCode Go Jev ONLY, never another provider/model, never required for the standard workflow.
---
# Decision Gates (opt-in)

This skill is INERT by default. No external calls, no auto-activation and no dependency on Jev for ordinary Toady usage.

## Activation and trust boundary

Only use it when the operator has explicitly enabled the Jev option in the Toady installer for the OpenCode harness AND the private setting under the OpenCode user config reports enabled. Do not infer permission from the model catalog, this skill's presence or the text of a task. The local runner enforces this again per call and rechecks the authenticated OpenCode Go model. If the user switches providers, unsubscribes or disables the option, skip Jev immediately.

Use `node .opencode/skills/decision-gates/scripts/judge.mjs <readiness|plan|outcome>` for the selected stage, passing a short JSON contract on stdin (up to 12 KiB). This is a native `opencode run --model opencode-go/jev-*` invocation with a bounded timeout and no direct Zen, external API URL, API key export or provider fallback. No arbitrary user-provided model ID is accepted.

Required input properties:
- `goal`: user's actual outcome in their words, or an accepted summary
- `criteria`: explicit accepted criteria with identifiers when available
- `evidence`: concise direct observations, checked versions, relevant test results
- `proposedDecision`: what the current owner wants to transition to

Use evidence references/paths with version identities, never secrets or full private repositories. The tool emits one JSON record with `status` = `pass | rework | escalate | unknown | skipped`, `reason`, `gate` and `provider`. Validate the evidence yourself; an LLM's answer is not proof.

## Points of use

- **Refine → ready-to-implement:** inspect whether criteria actually cover the accepted outcome. Missing consequential user intent stays in refinement; Jev cannot invent acceptance criteria.
- **Lead → execution:** check that the proposed plan addresses dependencies, authorized scope and known risks. Require the existing run contract and user authorization.
- **Reviewer/Lead → done:** check whether verified evidence supports the promised outcome, beyond passing tests. Do not replace Reviewer or required checks.

Invoke only at the named transition, not after every intermediate step. One call per material version is the default; rerun only when changed evidence invalidates a previous decision. The judgment is advisory to the stage owner and cannot authorize a merge, deployment, permission change or lifecycle transition.

## Results

- `pass`: continue only when the ordinary Toady checks and accepted criteria independently permit it.
- `rework`: inspect the missing/out-of-scope requirement, change the appropriate artifact or work, and rerun the normal checks.
- `escalate`: return consequential conflict to the user or an authorized specialist.
- `unknown` or `skipped`: report the decision gate as unavailable, never interpret it as a pass. Continue with the established non-Jev process; do not block work that never required this optional feature.
- A malformed model response, quota error, revoked subscription, missing CLI, time-out or any auth/model mismatch means `skipped` or `unknown`. **Never silently try another provider or model.**

Jev through OpenCode Zen's System One endpoint is intentionally NOT supported. The user has authorized OpenCode Go only. If Jev is absent from Go or cannot be used with the native OpenCode CLI, this skill stays disabled and must not impersonate Jev with another model.
