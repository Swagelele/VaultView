---
title: "Invariant guardian aggregate — protecting the location-holding conservation rule"
created: 2026-06-23
type: refactor-plan
---

# Invariant guardian aggregate — the location-holding conservation rule

> A PLAN, not implementation. Read-only on production code. Cites verified `file:line` at git `392ed25`.

## STEP 0 — Context discovered

**Stack:** Astro 6 SSR on Cloudflare workerd, React 19 islands, Supabase (Postgres + RLS), TypeScript, Zod at boundaries, Vitest. No generated DB types — the Supabase client is untyped.

**Where business logic lives — the trade write-spine, by layer:**

| Layer | File | Role for the domain |
|---|---|---|
| UI | `src/components/portfolio/TransactionForm.tsx` | client-side balance hint + sell-all autofill |
| API route | `src/pages/api/transactions.ts`, `.../transactions/batch.ts`, `.../holdings.ts` | auth gate → parse JSON → call service → map result to HTTP |
| Validation | `src/lib/schemas.ts` | Zod shape + cross-field refinements (per-row only) |
| Service | `src/lib/transaction-service.ts` | the actual write path: balance guard, price resolution, insert |
| Domain engine | `src/lib/pnl-engine.ts` | history-replay reducer: positions, realized P&L, clamp |
| Persistence | `supabase/migrations/*.sql` | row-level CHECKs + RLS |

The system is **history-replay**: a write persists one `transactions` row; all positions and P&L are recomputed on read by replaying the full history (`pnl-engine.ts:50` `computePositions`). There is no positions/cost-basis table — state is the fold of the event log.

---

## STEP 1 — Business invariants identified

| # | Invariant | Source (docs + code) |
|---|---|---|
| **I-1** | **You cannot dispose of (SELL/SWAP/WITHDRAW) more of an asset than you currently hold at that location.** | PRD US-03 AC ("sell-all quantity matches the exact current holding at that *specific location*"), US-05 AC ("Withdraw quantity cannot exceed current holdings at that location"), FR-006. Code: balance guard `transaction-service.ts:107-115`; engine clamp `pnl-engine.ts:84,91-95`; SQL has **no** balance CHECK (`migration:11,15,18` are per-row `> 0` only). |
| I-2 | Realized P&L is computed against a deterministically-ordered average cost. | PRD Guardrail "arithmetically correct / verifiable". Code: sort `(transaction_date, created_at)` `pnl-engine.ts:60-64`; avg-cost `:85-86`. Already well-enforced + tested (`pnl-engine.test.ts:375,409,442`). |
| I-3 | No user ever sees another user's data. | PRD Guardrail "User data isolation". Code: RLS policies `migration:37-52`; `.eq("user_id", userId)` on every query. Enforced at the DB. |
| I-4 | DEPOSIT derives cost basis from the historical price at the purchase date. | PRD FR-005, US-04. Code: `resolvePriceUsd` DEPOSIT branch `transaction-service.ts:66-70`. |
| I-5 | A non-stablecoin USD valuation must resolve, or the write is rejected. | PRD FR-007. Code: `priceUsd === null` → 400 `transaction-service.ts:127-133`. |

---

## STEP 2 — Classify and pick #1

Rated on (a) **core to product purpose**, (b) **spread across layers**, (c) **enforcement quality**:

| Inv | (a) Core | (b) Spread | (c) Enforced? | |
|---|---|---|---|---|
| **I-1 holding conservation** | **Highest** — US-03/US-05 are dedicated stories; it is the difference between a real ledger and a fiction | **Widest — 5 layers, 2 disagreeing reducers** | **Weak / inconsistent** — see below | **← PICK** |
| I-2 deterministic avg-cost | High | 1 (engine) | Strong (tested) | |
| I-3 RLS | High (security) | DB + query glue | Strong (DB-enforced) | |
| I-4 deposit basis | Medium | 1 (service) | Adequate | |
| I-5 price resolves | Medium | 1 (service) | Adequate | |

**Chosen #1: I-1 — "you cannot over-dispose a holding at a location."** It is **both** the most core to the product's purpose **and** the most weakly/inconsistently enforced. Unlike I-2 (one tested reducer) or I-3 (one DB mechanism), I-1 is implemented by **two independent reducers that compute "the holding" differently and can disagree**, with the DB enforcing nothing and the UI being only an advisory hint.

### Why I-1 is weakly enforced — the two-reducer divergence (verified)

There are **two** answers to "how much do you hold at a location," and they do not agree:

1. **Guard reducer** — `getHoldingAtLocation` (`transaction-service.ts:13-48`): an **order-independent signed sum** over rows at the location. It **ignores `price_usd`** — it folds *every* matching row, including rows the engine would treat as unpriced. Used for the pre-insert 409 (`:107-115`) and for sell-all-global validation (`:185`).
2. **Engine reducer** — `computePositions` (`pnl-engine.ts:50-104`): an **order-dependent** fold that (i) **skips rows where `price_usd === null`** (`:67-70`) and (ii) **clamps** a disposal against a non-positive position to realized-0 (`:84,91-95`).

Three concrete disagreement modes:

- **Unpriced rows:** the guard counts an unpriced acquisition toward the holding; the engine drops it. The guard can authorize a SELL the engine then cannot fund → clamp → **phantom position + dropped realized P&L**.
- **Same-minute tie (documented in `lessons.md:12-17`):** the guard's sum is order-free and always "correct"; the engine depends on the `(transaction_date, created_at)` tiebreaker (`pnl-engine.ts:60-64`). Where the tiebreaker is the load-bearing fix, the two reducers still answer from *different definitions* — the guard says "sellable," a mis-ordered engine says "have 0" (`lessons.md:15`).
- **Fail-soft clamp:** the engine's over-sell path is **log-and-continue, not fail-fast** — it silently records realized `0` and moves on (`pnl-engine.ts:91-95`), the exact opposite of the fail-fast posture this refactor requires. An illegal disposal that slips past the guard does **not** stop; it corrupts the replay quietly behind a 200 OK.

This is the strong candidate the brief predicted, **verified in code**: a service pre-check 409 on an *unclamped sum* AND a separate engine clamp `if (sourcePos.quantity > 0)` with a same-minute-tie hazard — two reducers that can disagree.

---

## STEP 3 — Diagnose: where the rule lives today

| Layer | Location | What it does for I-1 | Verdict |
|---|---|---|---|
| **UI** | `TransactionForm.tsx:134` (`insufficientBalance`), `:518,:636` (sell-all autofill from `availableBalance`), `:750` (submit disabled) | Advisory only — fetches `/api/holdings` (`:40`) and blocks the button. **Trivially bypassable** (direct POST). | client guard only |
| **API** | `api/transactions.ts:25`, `api/transactions/batch.ts:25`, `api/holdings.ts:25` | Thin pass-through to the service; no invariant logic of its own. | OK (thin) |
| **Validation** | `schemas.ts:22-66` | Enforces per-row shape (one-sided vs two-sided, positive quantities) but **cannot** see holdings — refinements are single-row. Does **not** touch I-1. | structurally cannot enforce |
| **Service guard** | `transaction-service.ts:107-115` (single), `:184-207` (sell-all) | The **only server enforcement**. Pre-insert read-then-check (TOCTOU window admitted at `:228-231`). Uses reducer #1. | enforced, but **separate** from the engine |
| **Domain engine** | `pnl-engine.ts:84,91-95` | The clamp. **Fail-soft** — silently records `0`, does not throw. Uses reducer #2 (skips unpriced, order-dependent). | **inconsistent + swallowed** |
| **Persistence** | `migration:11,15,18` | Per-row `> 0` CHECKs; RLS. **No cross-row balance constraint.** | does not enforce I-1 |

**Layers that do NOT enforce it:** SQL (no balance constraint), Zod (can't — single-row scope), UI (advisory). **Enforced inconsistently:** service guard (reducer #1) vs engine clamp (reducer #2) compute "the holding" by different rules. **Swallowed instead of stopping:** the engine over-sell clamp (`pnl-engine.ts:91-95`) records `0` and continues rather than failing.

**Test reality:** the engine clamp/tie are well covered (`pnl-engine.test.ts:375,409,442`). The **service 409 guard branch is not directly unit-tested** — `transaction-service.test.ts:233,250` cover only `getHoldingAtLocation`'s DB-error and zero-holding cases, not `createTransaction`'s `holding < source_quantity` → 409 decision (confirms research D3).

---

## STEP 4 — Design: the guardian aggregate

**Aggregate:** `LocationHolding` — the consistency boundary is **(user, asset, location)**. It is the single authority for "how much is held" and the single place a disposal is admitted or refused. It is reconstituted by **replaying the event log through the one canonical reducer** (the engine's definition becomes *the* definition), eliminating reducer #1 entirely.

### Single canonical reducer (collapse the two)

`getHoldingAtLocation`'s hand-rolled sum is **deleted**. Holding is read from `computePositions` so the guard and the engine can never disagree:

```ts
// pnl-engine.ts (already exists) is the single source of "holding".
// New thin helper, same fold the engine uses — no second definition.
export function holdingOf(positions: PositionMap, asset: string, location: string): number {
  return positions.get(`${asset}::${location}`)?.quantity ?? 0;
}
```

### Named domain error (fail-fast, not log-and-continue)

```ts
// src/lib/domain/errors.ts
export class InsufficientHoldingError extends Error {
  readonly code = "INSUFFICIENT_HOLDING";
  constructor(
    readonly asset: string,
    readonly location: string,
    readonly have: number,
    readonly need: number,
  ) {
    super(`Insufficient ${asset} at ${location}: have ${have}, need ${need}`);
    this.name = "InsufficientHoldingError";
  }
}
```

### The aggregate with preconditions

```ts
// src/lib/domain/location-holding.ts
export class LocationHolding {
  private constructor(
    readonly userId: string,
    readonly asset: string,
    readonly location: string,
    private quantity: number,   // canonical, from computePositions
  ) {}

  static rehydrate(userId, asset, location, positions: PositionMap): LocationHolding {
    return new LocationHolding(userId, asset, location, holdingOf(positions, asset, location));
  }

  /** Precondition for any disposal (SELL/SWAP/WITHDRAW, and every sell-all leg). */
  assertCanDispose(qty: number): void {
    if (qty > this.quantity) {
      throw new InsufficientHoldingError(this.asset, this.location, this.quantity, qty);
    }
  }

  sellableAll(): number {       // replaces the UI/sell-all "available" math
    return this.quantity > 0 ? this.quantity : 0;
  }
}
```

The engine clamp at `pnl-engine.ts:84,91-95` becomes a **guarded invariant assertion** rather than a silent skip: on read-replay it should no longer be *possible* to over-dispose (writes are pre-checked against the same reducer), so a hit on the clamp now signals corrupt history and throws `InsufficientHoldingError` (or a sibling `CorruptLedgerError`) — surfacing the bug instead of masking it. The deterministic `(transaction_date, created_at)` sort (`:60-64`) stays as a correctness input to the single reducer.

### Repository (load/save the aggregate, atomic write)

```ts
// src/lib/domain/holding-repository.ts
export interface HoldingRepository {
  // ONE history read → one computePositions fold → reusable PositionMap for the whole request.
  load(userId: string): Promise<PositionMap>;
  // Single-statement insert; on multi-leg sell-all, one multi-row insert = one atomic write.
  append(rows: TransactionInsert[]): Promise<Transaction[]>;
}
```

Atomicity: the single insert is already atomic (`transaction-service.ts:158`, batch `:232`). The residual TOCTOU between read and insert (`:228-231`) is documented as acceptable at single-user scale; the aggregate does not worsen it and centralizes the one place to later add a `SELECT ... FOR UPDATE`/RPC if scale demands.

### Thin API/route (parse → aggregate method → map domain error)

```ts
// createTransaction, post-Zod-parse:
const positions = await repo.load(userId);
if (input.type !== "DEPOSIT") {
  LocationHolding
    .rehydrate(userId, input.source_asset, input.location, positions)
    .assertCanDispose(input.source_quantity);   // throws InsufficientHoldingError
}
// ... resolvePriceUsd, buildTransactionRow, repo.append([row])

// api/transactions.ts catch:
catch (e) {
  if (e instanceof InsufficientHoldingError) return errorResponse(e.message, 409);
  throw e;
}
```

Sell-all-global rehydrates one aggregate per leg from the **same** `positions` map (one history read), calls `assertCanDispose` per leg, accumulates all `InsufficientHoldingError`s, and refuses the whole batch if any leg fails (preserving the existing all-or-nothing 409 at `:224-226`) — but now via the canonical reducer, not reducer #1.

---

## STEP 5 — Before/after per current location + phased plan

### Before → after

| Location today | Before | After |
|---|---|---|
| `transaction-service.ts:13-48` `getHoldingAtLocation` (reducer #1) | hand-rolled order-independent sum, ignores `price_usd` | **deleted**; replaced by `holdingOf(positions,…)` over the engine's fold |
| `transaction-service.ts:107-115` 409 guard | inline `holding < qty` using reducer #1 | `LocationHolding.assertCanDispose` (reducer #2 / canonical) |
| `transaction-service.ts:184-207` sell-all validation | per-leg reducer #1 + inline error push | per-leg `assertCanDispose` on shared `PositionMap`, errors collected |
| `pnl-engine.ts:84,91-95` clamp | **fail-soft** silent realized-`0` | guarded assertion → throws on impossible over-sell (fail-fast) |
| `api/holdings.ts:25` | calls reducer #1 | calls `LocationHolding.sellableAll()` (canonical) so the UI hint matches the server exactly |
| `TransactionForm.tsx:134,518,636,750` | advisory hint from a now-divergent source | unchanged role (advisory), but its `/api/holdings` source is now the canonical number |
| `migration` | no balance constraint | (optional, deferred) — Postgres can't cheaply express cross-row balance; keep enforcement in the aggregate |

### Phased refactor (test-first phases marked 🔴)

- **Phase 0 🔴 — Characterize the gap (RED first).** Add the missing tests that pin today's behavior before changing it: (a) `createTransaction` 409 over-sell branch (currently untested per D3); (b) a test asserting reducer #1 and reducer #2 **disagree** on an unpriced acquisition (locks the divergence as a known defect). Vitest + existing `fakeSupabase`/`vi.mock("@/lib/coinpaprika")` harness (`transaction-service.test.ts:211-219`).
- **Phase 1 🔴 — Introduce `holdingOf` + `LocationHolding` + `InsufficientHoldingError`.** Pure additive, unit-tested in isolation against a `PositionMap`. No call-site changes yet; everything compiles and the suite stays green.
- **Phase 2 — Route `createTransaction` through the aggregate.** Replace the `:107-115` guard; map the error in `api/transactions.ts`. The Phase 0 409 test now passes via the new path; the divergence test flips (guard now uses the engine's definition).
- **Phase 3 — Route sell-all + `/api/holdings` through the aggregate.** Replace `:184-207` and `holdings.ts:25`; delete `getHoldingAtLocation`.
- **Phase 4 — Harden the engine clamp to fail-fast.** Turn `pnl-engine.ts:91-95` into a guarded assertion; existing clamp/tie tests (`pnl-engine.test.ts:375,409,442`) are updated to assert the new throw on genuinely-impossible histories while keeping float-residue tolerance (`CLOSED_EPSILON`) intact.
- **Phase 5 — (optional) add `npm test` to CI** (`ci.yml` runs no tests today per refactor research §"CI runs NO tests") so the invariant becomes a real gate, not local-only.

### Test cases — legal and illegal

**Legal (must pass):**
- SELL of exactly the full holding at a location (sell-all equality, US-03 AC).
- SELL of less than holding; WITHDRAW within holding (US-05 AC).
- DEPOSIT — never balance-checked (`type === "DEPOSIT"` skip).
- Same-minute funding BUY + SELL: SELL admitted and realizes P&L (no phantom) — reuses `pnl-engine.test.ts:375`.
- Sell-all-global across N funded locations: all legs admitted, one atomic insert.

**Illegal (must throw `InsufficientHoldingError`, fail-fast, no row written):**
- SELL/SWAP/WITHDRAW of `holding + ε`.
- SELL against zero holding.
- Sell-all-global where ≥1 leg has zero/insufficient holding → whole batch refused (409), nothing inserted.
- Over-sell built on an **unpriced** acquisition — the case where the two reducers diverge today; after Phase 2 both agree and it is refused.
- Replay encountering an impossible over-sell → engine throws rather than recording silent `0` (Phase 4).

---

## Summary

The domain's most core *and* most weakly-enforced invariant is **I-1: you cannot dispose of more of an asset than you hold at a location** (PRD US-03/US-05, FR-006) — it is enforced by **two reducers that can disagree**: an order-independent, price-blind sum in `getHoldingAtLocation` (`transaction-service.ts:13-48`) drives a pre-insert 409, while an order-dependent, price-skipping clamp in `computePositions` (`pnl-engine.ts:84,91-95`) silently records realized-`0` on over-sell. The SQL layer enforces nothing cross-row, Zod structurally cannot (single-row scope), and the UI guard is advisory-only and bypassable. The two reducers diverge on unpriced rows and same-minute ties (the latter documented in `lessons.md`), and the engine clamp is fail-soft — it masks an illegal disposal behind a 200 OK instead of stopping. The fix is a `LocationHolding` guardian aggregate over a **single canonical reducer** (the engine's fold, exposed via `holdingOf`), whose `assertCanDispose` precondition throws a named `InsufficientHoldingError`; the hand-rolled second reducer is deleted, the engine clamp becomes a fail-fast assertion, and thin routes map the domain error to 409. The phased, test-first plan characterizes the currently-untested 409 branch and the reducer divergence first (RED), then introduces the aggregate additively before re-pointing each call site, ending with optional CI wiring so the invariant becomes a real gate. No production code was changed — this artifact is a plan.
