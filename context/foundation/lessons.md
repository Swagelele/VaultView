# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Always verify cost basis matches form price

- **Context**: Portfolio P&L display — any phase where cost basis is compared against live prices. Includes per-transaction unrealized P&L on the `/transactions` list (`transaction-service.ts` `getTransactionsWithPnl`, where `unrealized = target_qty × live_price − source_qty × price_usd`).
- **Problem**: After buying an asset, instant unrealized P&L appeared even though the trade was just submitted. The root cause is not yet diagnosed — it could be price suggestion drift, rounding, or a cost basis resolution issue. The symptom is that cost basis doesn't match what the user expected to pay. **Note (S-04 transaction-list-filters):** some instant non-zero unrealized P&L is *expected by design* — live mark-to-market compares the recorded cost basis against the current ticker, which differs from the executed price by spread/drift even seconds after a buy. The per-row transaction view surfaces this far more visibly than the aggregated dashboard, so it is easy to mistake the benign live-mark drift for a real cost-basis bug.
- **Rule**: Always verify that the cost basis stored from a transaction matches the price the user saw in the form at submission time. When implementing or testing P&L features, compare the recorded `avg_cost_usd` (and the per-tx `price_usd`) against the price entered in the form to catch drift. When a *per-row* unrealized value is shown, first rule out expected live-mark drift before treating a non-zero fresh-buy figure as a defect; if the live-mark behavior is intended, explain it (tooltip/legend) or snapshot the entry mark so a brand-new purchase reads ~0.
- **Applies to**: plan, implement

## Order P&L transactions deterministically — transaction_date ties cause phantom positions

- **Context**: Any holding/P&L computation that processes transactions in sequence (`pnl-engine.ts` `computePositions`, anything sorting by `transaction_date`).
- **Problem**: Datetime inputs are minute-precision (`datetime-local` + `.slice(0,16)`), so a BUY and a same-minute SELL get identical `transaction_date`. The P&L engine clamps over-sells (`if (position > 0)`). When the SELL sorts *before* its funding BUY (tie order is nondeterministic from the DB), the clamp silently skips the SELL's source reduction while the BUY still adds quantity — leaving a **phantom position** and **dropping the SELL's realized P&L**. The unclamped validator (`getHoldingAtLocation`, an order-independent sum) disagrees, so the UI shows a sellable quantity the server rejects ("have 0"). Surfaced by sell-all-global (S-08).
- **Rule**: Sort P&L/holding transactions by `(transaction_date, created_at)`, never `transaction_date` alone. `created_at` reflects causal insertion order (a funding BUY is always created before the SELL of its proceeds), which makes the clamp behave correctly. When a sequential reducer clamps, a deterministic tiebreaker is part of correctness, not cosmetics.
- **Applies to**: plan, implement

## CoinPaprika boundary has two unguarded failure modes (documented, not yet fixed)

- **Context**: `src/lib/coinpaprika.ts` — the only module that talks to the CoinPaprika price API. Surfaced while writing Risk #5 boundary tests (`coinpaprika.test.ts`, change `testing-pnl-trade-math` Phase 3).
- **Problem**: Two gaps the boundary tests deliberately do **not** close. (1) **No response-type validation.** `safeFetch` does `(await res.json()) as T` (`coinpaprika.ts:23`) with no Zod/`Number.isFinite` guard — every response interface field is optional and guarded only by `?? null`. A 200 response carrying a non-number `price` (e.g. a string) would pass the `!== null` checks (`:65`, `:145`) and propagate a non-finite value into P&L (`portfolio-service.ts:48`, `PortfolioView.tsx`). CoinPaprika returns numbers in practice, so this is latent, not observed. (2) **No request timeout.** `safeFetch` has no `AbortController`/`signal` (`:19-27`), so a hung CoinPaprika socket can hang the request indefinitely — a real availability vector, not exercisable at the unit layer.
- **Rule**: Treat the price boundary as degrade-to-`null` only for the cases it actually guards (non-200, network throw, missing field). Before relying on a price downstream, do not assume it is finite; if you touch this module, add a `Number.isFinite` guard at the parse point and an `AbortController` timeout around `fetch`. The timeout belongs to an observability/runtime follow-up, not a unit test.
- **Applies to**: plan, implement
