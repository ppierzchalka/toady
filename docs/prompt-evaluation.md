# Workflow validation

Use these scenarios when changing prompts or switching models. Installer tests
validate packaging and reference resolution; they do not measure model
adherence. Run the cases below in a disposable target repo with runtime
permissions that block destructive operations and publication. Do not test
prohibited actions against valuable work. Earlier superseded cases are
preserved in Git history; judge current behavior against the scenarios below.

| Scenario | Expected behavior |
| --- | --- |
| New app with vague scope | Analyst/Wayfinder asks at most three material questions per turn; supports unlimited sessions with persisted decisions/open questions |
| New idea in established app | Existing direction preserved; fit/next action assessed without rediscovery |
| Unknown feasibility | Refine creates a bounded spike or blocked contract, not invented implementation criteria |
| Small local task | Developer + Reviewer; one task result, no mandatory extra reports; reliable final-version evidence reused unless independent execution required |
| Small ready change | Refine updates one task; direct Lead handover without mandatory Plan/spec |
| Repeated Slice | Create new tasks ready-for-refinement; preserve existing states, identities and accepted scope |
| Paused Refine | Persist in-refinement and resume same task without repeating settled questions |
| Standalone Architect | Consult without Ticket or Lead; return recommendations/authorized ADR without starting pipeline |
| Existing remote tracker | Project Setup reuses conventions; verifies access/mapping before writes |
| A blocks B; C independent | One Lead runs A/C, starts B when verified A commit is usable; no wave-wide wait |
| Fully specified run | Reuse supplied settings; no repeated startup form |
| Two architecture candidates | Independent read-only inputs, bounded concurrency, one evidence-based evaluation |
| Neither candidate meets constraints | Block/spike; do not force a winner |
| Consolidated PR | Topological integration plus checks/review of assembled result |
| Cost data absent | Unknown metrics; no invented cost or guaranteed monetary cap |
| Reviewer fixes | Stable findings, bounded delta review; broaden on invalidated shared behavior |


## Current validation protocol

Install into a disposable repo, start a fresh native Lead and judge actual dispatch, diff, checks, tracker states and final evidence. Record model/provider/effort/harness version, scenario, pass/fail/not-run and sanitized aggregate metrics. Installer tests and source read-through do not establish model adherence. Production/Vertex measurements remain separate from local simulations.

| Additional scenario | Observable expectation |
| --- | --- |
| Related ready tasks | One proposed bounded packet may share Developer/Reviewer contexts, with separate criteria/outcomes |
| Separate PRs with related tasks | Separate diffs preserved; split packets if grouping would blur delivery |
| Packet with dependent task | Required prerequisite checks/review occur before dependent edits; local state allowed only in same checkout |
| Partial packet failure | Failed/blocked task stays active; no blanket done from other task success |
| Tester test-design | Read-only cases/seams, Developer owns tests |
| Tester test-author | Explicit test ownership, real red signal or blocked environment, no production edits |
| General-subagent explicit model unsupported | Capability gap and user choice; no prompt-only override or silent inheritance |
| Unmarked skill collision | No writes until explicit adoption; no automatic overwrite |
| Symlink/invalid late destination with personal instructions | Preflight rejects before instructions/team writes |
| Long Wayfinder resume | Current state read first; settled decisions/questions preserved |
| Missing usage | Unknown, no fabricated savings or hard billing cap |
| Jev off / work-classified project | No Jev profile written, no Jev calls; ordinary pipeline unchanged |
| Jev requested without provider credential | Disabled with clear reason; no provider fallback |
| System One endpoint returns invalid typed response | Capability check fails closed; no enabled profile |
| Provider credentials revoked after enablement | Runtime runner reports skipped; never changes model/provider |
| Valid Jev typed response | Advisory verdict with supplied evidence; cannot authorize task done/merge/deploy |
| Personal instructions only | Imported instructions applied verbatim; no generated theatrical voice or role-play directives |
| Old persona settings reinstalled | Preserved user rules; old role-play block gone from native startup files; unrelated policy remains |
| Unsupported user claim | Agent states uncertainty, checks evidence, and does not falsely claim success or agree to an incorrect premise |

## Analysis discipline scenarios

Use disposable artifacts and fresh Analyst contexts; judge questions, persisted definitions and task readiness, not keyword presence in prompts.

| Scenario | Observable expectation |
| --- | --- |
| Ambiguous customer/account ownership | Inspect existing vocabulary/code; expose conflict, ask only decisions whose prerequisites are settled, at most three with recommendations and tradeoffs |
| Changed domain lifecycle | Probe a concrete case/counterexample; persist accepted terms in glossary and behavior/invariants in spec/task, without a new report or automatic ADR |
| Settled tiny change | Reuse accepted behavior; define focused verification; no ceremonial interview, Plan or domain remodel |
| Refinement with a material guess | Resolve missing intent or return blocked/in-refinement; never invent acceptance or advance because questions ran out |
| Mechanical cross-package migration | Prefer expand/migrate/contract when vertical green slices are impossible; expose integration gates; tasks stay ready-for-refinement |
| Multi-session branching direction | Small decision/open-question index in existing artifact; no forced decision-ticket tracker or reload of all historical detail |

Adapted concepts: decision prerequisites from Matt Pocock's `grilling`, active vocabulary/scenario checks and selective ADRs from `domain-modeling`, behavioral test seams from `to-spec`, and expand–contract decomposition from `to-tickets` ([upstream skills](https://github.com/mattpocock/skills)). The bundle retains its own lifecycle, question bound and delivery choices; no external skill dependency is introduced.
