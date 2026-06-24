---
change_id: refactor-opportunities
title: "Rank and plan refactor opportunities from the trade-spine analysis"
status: plan_reviewed
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

Intent: we have an analysis documenting this repo's technical debt and structural risks — context/changes/trade-flow-analysis/research.md. This change answers the question that analysis deliberately left open: WHICH of those problems are worth fixing, in what target shape, and in what order. We explore each recorded problem in code and history, then rank them as refactor opportunities. The change runs in stages: exploration → decision + plan → implementation. At the exploration stage NO refactor happens and NO decision is made. Exploration output: this change's research.md, ending with a ranked list of options and trade-offs. I read the report first; the decision on what to implement happens at the planning stage, and refactoring only starts per the approved plan.
