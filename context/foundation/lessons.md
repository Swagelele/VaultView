# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Always verify cost basis matches form price

- **Context**: Portfolio P&L display — any phase where cost basis is compared against live prices
- **Problem**: After buying an asset, instant unrealized P&L appeared even though the trade was just submitted. The root cause is not yet diagnosed — it could be price suggestion drift, rounding, or a cost basis resolution issue. The symptom is that cost basis doesn't match what the user expected to pay.
- **Rule**: Always verify that the cost basis stored from a transaction matches the price the user saw in the form at submission time. When implementing or testing P&L features, compare the recorded `avg_cost_usd` against the price entered in the form to catch drift.
- **Applies to**: plan, implement
