# Swap Price Provider CoinPaprika → Binance — Plan Brief

> Full plan: `context/changes/binance-price-provider/plan.md`
> Frame brief: `context/changes/binance-price-provider/frame.md`

## What & Why

The deployed app's price/asset data is permanently quota-walled and fails invisibly:
CoinPaprika's keyless tier (20k/month, per-IP) is over quota from the Worker's shared
Cloudflare IP → 402, swallowed into an empty UI. We swap the provider to Binance's public
market-data host (`data-api.binance.vision`) behind a contained adapter, and make failures
visible. The shared price cache is scale insurance the evaluation does not need — deferred.

## Starting Point

One price boundary (`src/lib/coinpaprika.ts`, 6 functions) feeds 5 consumers. The persisted
asset id is the CoinPaprika id (`btc-bitcoin`), used as an opaque key everywhere; its format
is interpreted in only 3 spots. The `transactions` table is freshly migrated and empty.

## Desired End State

On production, autocomplete returns assets, price suggestions populate, and live + historical
prices load from Binance. When the provider is unreachable, the UI shows a clear error /
manual-entry affordance instead of blanking. Verified by a live E2E: search → BUY → prices +
history render → DEPOSIT resolves a historical cost basis.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Provider | Binance `data-api.binance.vision` | Reachable where `api.binance.com` is blocked; per-minute weight resets (resilient to shared IP) | Frame |
| Shared price cache | Deferred | Gold-plating for a small-group eval | Frame |
| Canonical asset id | Uppercase ticker (`BTC`, `USDT`) | Binance-native; search emits it directly; ~3 one-line edits | Plan |
| Asset list source | Committed static list (generated once) | No 17 MB runtime fetch; instant, deterministic | Plan |
| Coin labels | Ticker-only | Zero extra work; ships fast | Plan |
| Module | Rename → `src/lib/prices.ts` | Filename stops lying; imports are mechanical | Plan |
| Error UX | Minimal distinct error states | Kills the "looks broken" failure mode cheaply | Plan |
| Stablecoins | Adapter returns `$1` for USDT + USDC | Fixes `USDTUSDT` gap; matches engine's existing $1 treatment | Plan |

## Scope

**In scope:** Binance adapter (search + current + historical) behind the existing contract;
committed static asset list; ticker-id switch; stablecoin → $1; timeout + finite guards;
visible error states; production verification.

**Out of scope:** Shared Supabase price cache; live-poll hardening; coin-name registry;
CoinPaprika key / fallback provider; data migration (table empty).

## Architecture / Approach

Anti-corruption adapter: `src/lib/prices.ts` re-implements the six functions against Binance,
keyed by asset id, with host/symbol-mapping/parsing/stablecoin/degradation confined inside.
Consumers change only their import path. Canonical id = uppercase ticker → Binance symbol
`${id}USDT`. Search reads a committed trimmed list, not the 17 MB `exchangeInfo`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Adapter + static list | New `prices.ts` + asset list + ported boundary tests | Binance response-shape parsing (strings, klines indexing) |
| 2. Rewire + id format | 5 imports repointed, ticker ids, fixtures updated, green suite | Missed `usdt-tether`/`btc-bitcoin` fixture references |
| 3. Visible error states | Search + price-suggestion error affordances | Over-building UX against the deadline |
| 4. Deploy + verify | Live E2E, Cloudflare-region reachability confirmed | `data-api.binance.vision` blocked from Worker region (low) |

**Prerequisites:** Production DB confirmed empty (it is); Cloudflare deploy access.
**Estimated effort:** ~2 focused sessions across 4 phases.

## Open Risks & Assumptions

- **Cloudflare-region reachability** of `data-api.binance.vision` is verified from the dev
  network but must be confirmed from the Worker region (Phase 4 smoke test). Low risk.
- Assumes ticker-only labels are acceptable for evaluation (no full coin names).
- Assumes the static asset list (USDT-paired TRADING base assets) covers the assets testers
  will pick; regeneration is a documented one-liner if not.

## Success Criteria (Summary)

- Deployed autocomplete, price suggestions, live + historical prices all work from Binance.
- Provider failure shows a clear error/manual-entry affordance, never a silent blank.
- Full unit suite green with ticker-id fixtures; production E2E (BUY + DEPOSIT) passes.
