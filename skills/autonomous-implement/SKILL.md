---
name: autonomous-implement
description: Execute ready Tickets with a configurable cost-aware team, dependency scheduling, independent proposals and chosen worktree/PR delivery.
disable-model-invocation: true
---

# Autonomous Implement

Act as the single Lead. Load [Lead instructions](references/roles/lead.md) only when they are not already present in this context. Read [TEAM-POLICY.md](TEAM-POLICY.md) and [run contract](references/run-contract.md) once per context. Consume GitHub, Azure DevOps or local Tickets using configured project tools. Do not restart Analyst's discovery.

## Harness capabilities

Require native multi-agent spawning and isolated candidate contexts. If unavailable, stop with the missing capability; do not silently run a single-agent substitute. Use installed named agents when available. Otherwise read the installed references/roles/<name>.md and pass those instructions to a native general subagent, explicitly identifying the role source. This is a native multi-agent workflow, not a fallback to sequential single-agent execution. Read only the assigned role entry in `references/roles/runtime.json` when native dispatch does not resolve its definition. That entry records model/effort and native-definition location. Honor explicit overrides and approved provider boundaries. A general subagent must receive the role instructions **and** enforce the selected supported model/effort/tool constraints through its native launch settings. Passing model names as prompt text is not enforcement. If an explicit selection cannot be applied/verified, report a capability gap and obtain a choice; never silently inherit instead. Inheritance remains valid when selected. Do not require exact tool names or provider IDs from another harness.

## Optional decision gates

If the user explicitly opted into Jev for this personal project, use [Decision Gates](../decision-gates/SKILL.md) at **plan handover** and **final outcome completion**, passing accepted scope and verified evidence. The gate is advisory and never replaces native tests, Reviewer findings or user approval. When disabled, unavailable or on another harness, do not invoke Jev or any substitute provider; continue the normal workflow unchanged.

## Intake and handover

Read one or more refined tasks with mapped ready-to-implement status (or an equivalent explicit user-supplied ready contract), criteria, relevant code/instructions, dependencies, workspace status and checks. Preserve task identities. No separate Plan session is required: prepare proportionate technical execution details during intake, consulting Architect when enabled. Return consequential requirement gaps to Analyst/user instead of implementing guesses. Resolve consequential blockers. Propose the smallest team and one run contract: roles, candidates, concurrency, gates, workspace, PR mode, permissions and limits. Reuse explicit user settings and project execution defaults recorded by Setup; present only material choices/differences, not a form of every default. Ask only for missing/material choices. Before execution explicitly ask the user to choose local delivery, separate PRs, stacked PRs or one consolidated PR unless they already supplied that choice. Never assume stacking/consolidation from a batch request. Confirmation covers the batch and its dependent Tickets/fix loops.

Classify at intake: small (bounded, settled behavior, local surface), standard (multiple boundaries/dependencies), or complex/high-risk (uncertain design, migrations/security or broad integration). Classification chooses context depth and recommended roles, not permission to bypass requirements or gates. Reassess on new evidence; do not expand team/candidates without agreed configuration. Small still uses Developer + independent Reviewer by default.

Recommend lean (Developer + Reviewer), standard (add specialists with concrete value) or critical (explicit extra analysis/verification). Tester defaults to read-only test-design when enabled; explicit test-author mode assigns test files to Tester. Developer owns tests/checks otherwise; profiles are recommendations, not mandatory bundles.

## Execution packets

Task identity, execution packet, review unit and PR unit are independent. Propose grouping bounded ready tasks with the same module/context, compatible ownership/permissions/checks and manageable combined scope. Record task IDs/criteria separately; never merge tracker identities or infer consolidated delivery from grouping. Do not group for separate PR delivery when it would blur independent diffs; use separate packets unless the agreed branching plan preserves them.

One packet may use one Developer context and one independent Reviewer context, checking each task and interactions. Split on risk, incompatible ownership, context growth or a materially different boundary. Reuse the worker only for a coherent packet, not indefinitely across unrelated work. Keep packet review bounds and per-task results. Grouping is a recommendation in the agreed handover, not a silent change to explicit per-task execution.

For local sequential dependents in the same checkout, verify the prerequisite's required checks/review before dependent edits; no commit is needed solely to retain local state. For cross-worktree prerequisites require usable verified commits and authorized integration. A packet does not waive a required intermediate gate. If an intermediate review is required, count its scope separately from final packet review rather than inventing approval.

## Schedule

Maintain one dependency graph/stage table. Dispatch enabled specialists directly with task-local context; Lead-per-Ticket requires explicit selection for a complex subproject.

- Run ready unblocked execution packets up to confirmed worker concurrency; retain per-task frontier/status. Concurrency measures writable workers, not task count.
- Run Architect/Security/UX concurrently only when inputs are independent. Resolve shared decisions before implementation.
- Use [independent proposals](references/proposals.md) for configured read-only candidates.
- Enabled Tester returns independent cases in test-design mode; in explicitly selected test-author mode writes meaningful red tests before implementation. Developer implements/verifies; Reviewer independently checks the final diff.
- Start cross-worktree dependents when all required usable verified commits exist and permissions allow commits/integration; same-checkout dependents follow the packet gate above. Never copy uncommitted changes between worktrees.
- Serialize overlapping writable paths or assign distinct ownership.

## Review and delivery

Default to two total Reviewer passes per review unit (one Ticket or the agreed packet); stop early on approval. Route actionable fixes to enabled owners without repeated confirmation. At the limit preserve work and report remaining finding IDs, cause, evidence and a specific next option; do not silently add passes or mark fixes approved without review. Rereview findings/deltas and invalidated evidence; broaden when shared behavior changes.

Read [worktrees and delivery](references/worktrees.md) only for isolation, dependency integration or PR delivery; a single local task needs no delivery reference. Run required assembled-result checks and review integration effects before final delivery. Deployment requires separate authorization. Preserve unfinished/unrelated work.

Record concise results, verified versions, checks/manual gaps, permissions and integration order. Read [usage reporting](references/usage.md) only when metrics/budgets are requested or available runtime usage is relevant. Do not create empty usage reports. Unknown cost/token values stay unknown.

This skill orchestrates the current agent session through instructions. It does not provide a scheduler service, tracker API client, hard billing limiter or process sandbox.

Update the same task records using configured lifecycle mappings: in-progress on dispatch, in-review at review, done only after the configured definition of done. Track blocked separately and never dispatch unresolved prerequisites. Preserve unrelated labels and distinguish local completion, PR delivery and merge. See [artifact contract](../project-setup/references/artifacts.md).

## Compact default protocol

One execution packet contains per-task identities/criteria plus criteria, relevant paths/base, role, checks and permission boundaries. Specialists return short chat results; Lead owns one task execution/result section including agreed configuration, class, checks/version, review verdict and remaining gates. Reuse existing task/spec text. No mandatory separate run record, stage-note files, empty fit headers or duplicated handoffs. For batches maintain only the needed dependency/stage table and shared run settings. Detailed artifacts remain available when useful or required. Preserve resumability and lifecycle statuses.
