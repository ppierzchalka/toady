---
name: wayfinder
description: Explore or resume the direction of an application, game, product area or major feature from briefs, documents or discussion, across as many sessions as needed.
---
# Wayfinder

Act as Analyst. Load [role instructions](../autonomous-implement/references/roles/analyst.md) only if absent from the current context; otherwise reuse them. Read project conventions, supplied materials and relevant existing direction. Use [artifact contract](../project-setup/references/artifacts.md) for persistence and its decision-question and active-domain-modeling discipline; reuse already loaded instructions.

1. Establish the scope: whole product, large area, new feature or changed direction. Reuse accepted decisions; identify contradictions instead of silently replacing them.
2. Explore audience, problem, experience/usage loop, constraints, outcomes, alternatives and non-goals as relevant. Ask at most three consequential questions per turn whose prerequisites are settled, with recommended answers/reasons and meaningful alternatives. There is no fixed round or session limit; follow the user's desired depth and pause/resume naturally.
3. Separate decisions, proposals, assumptions and unresolved questions. For branching exploration keep a compact index of decisions, dependent open questions and areas still too vague to specify in the existing direction artifact; link detail only as needed. Do not create decision tickets or a separate map by default. Sharpen domain meanings and probe relationships with concrete scenarios as they arise. Consult architecture/domain specialists within authorized scope when useful; do not require architecture or exhaustive edge cases before recording direction.
4. Maintain the smallest useful set of configured artifacts: brief/direction, spec, glossary/domain description and ADRs for significant decisions. Do not create every document type by default or a task for every question.
5. At a pause or meaningful milestone, persist the current state, source links, decisions, open questions and suggested next topic within authorized scope. If persistence is unavailable, return a clearly identified draft. On resumption read this state; do not restart discovery.

Optional Go Jev evaluation is available only through the explicit Decision Gates opt-in. It is not a discovery authority: never treat a model-proposed assumption as an accepted user decision. Do not query Jev on each exploration turn.

The user decides when to explore further or move on. Suggest Slice for selected scope; do not create a backlog or start implementation automatically. Partial direction is valid and does not imply implementation readiness.

## Resume state

At a pause/milestone update a small Current state section in the existing owning artifact: accepted decisions (links/IDs), active consequential questions, last material change, and next topic/action. Read this section first on resumption; retrieve historical rationale only when relevant. Preserve source history and distinguish superseded decisions. Do not repeat resolved questions or write a new summary after every turn. Long exploration is valid; finish depth follows the user's needs, not a minimum-MVP mandate.
