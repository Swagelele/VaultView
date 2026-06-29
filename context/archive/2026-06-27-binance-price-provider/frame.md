# Frame Brief: Swap price provider CoinPaprika → Binance

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

On the deployed app (`vault-view.*.workers.dev`), asset autocomplete returns nothing,
price suggestions are empty, and live portfolio prices fail to load. Localhost is fine.
Root verified live this session: CoinPaprika returns `HTTP 402 — "This plan has 20000
monthly requests limit, your requests rate is: 20004"`, and `safeFetch` swallows it into
an empty result (no error surfaced to the user).

## Initial Framing (preserved)

- **User's stated cause or approach**: CoinPaprika keyless tier is IP-rate-limited; the
  Worker's shared Cloudflare IP is permanently over the 20k/month cap. Compounded by
  per-user / per-keystroke / per-20s-poll fetching and a per-request in-memory cache that
  doesn't persist across Cloudflare isolates.
- **User's proposed direction**: Swap to Binance (`data-api.binance.vision`) for current +
  historical + asset list, add a shared Supabase price cache, and bundle/cache the coin
  list for local search.
- **Pre-dispatch narrowing**: Eval load = *a small group* of concurrent testers. Must-work
  surfaces = *all three* (asset search, current/live prices, historical prices). Live
  refresh = *on-load pricing is enough* (the 20s tick is nice-to-have, not graded).

## Dimension Map

The observation could originate at any of these dimensions:

1. **Provider quota / reachability** — keyless CoinPaprika monthly cap, exhausted on the
   shared Worker IP. ← initial framing (root blocker)
2. **Caching layer** — in-memory `Map` not shared across isolates/users, inflating call
   volume vs localhost.
3. **Failure visibility** — `safeFetch` degrades every failure to `null`/empty, so a quota
   block looks identical to "no data" (lessons.md documents this as a known unguarded mode).
4. **Asset-identifier coupling** — would a provider swap ripple through the persisted
   identifier and every downstream key? (Refactor-size risk → the user's deadline anxiety.)
5. **Replacement viability** — does Binance actually escape the shared-IP wall, or just
   reproduce it under a different name? (Premise to validate.)

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D1 Provider quota is the blocker | Live `HTTP 402` from CoinPaprika `/search` reproduced from two independent IPs this session | **STRONG** |
| D2 Cache inflates volume | `coinpaprika.ts:12-13` in-memory Maps; `searchCoins` not cached at all → per-keystroke live call. Real, but secondary | **WEAK** (contributing, not root) |
| D3 Silent failure hides the cause | `coinpaprika.ts:19-27` `safeFetch` returns `null` on any error; `assets/search.ts` + `AssetAutocomplete.tsx:43-51` render empty. lessons.md confirms | **STRONG** |
| D4 Identifier blast radius is large | CoinPaprika id (`btc-bitcoin`) is the canonical persisted key (`transactions.source_asset`), used in pnl-engine, portfolio/history/prices. BUT **Strategy A** (keep id as opaque key, swap only the price backend behind the same module contract) confines edits to `coinpaprika.ts` + `assets/search.ts`; DB is freshly migrated + empty → no data migration | **WEAK** (contained, not large) |
| D5 Binance reproduces the IP wall | Binance = **6000 weight/min per IP, resets every minute** (vs 20k/**month** never resetting). App uses ~0.7–1.3% of one IP's budget; 429s self-heal at the minute boundary. Live header `x-mbx-used-weight-1m` reset 45→2 across a clock minute confirmed | **NONE** (premise holds — LOW risk) |

Binance coverage (live-tested against `data-api.binance.vision`):
current price **FULL** (`/api/v3/ticker/price`, batch via `symbols=[...]`), historical
**FULL** (`/api/v3/klines` + `startTime/endTime`, read close `[4]`), search **PARTIAL**
(`/api/v3/exchangeInfo` → 437 USDT-paired base assets, but **no coin names / no rank**, and
a **~17 MB payload that must be fetched + filtered + cached server-side**). One coding gap:
`USDTUSDT` doesn't exist → hard-code USDT = $1. Symbol rule: `<TICKER> + "USDT"`.

## Narrowing Signals

- **Small group, not real traffic** → the *shared price cache* protects against load that
  won't exist during evaluation. Binance's per-minute budget makes even uncached per-user
  polling ~1% of capacity. → shared price cache is **deferrable**.
- **On-load pricing is enough** → no need to harden the 20s poll as a graded feature.
- **All three surfaces required** → the swap must cover search + current + historical; can't
  scope down to "just live prices."
- **A *list* cache is still required** (distinct from the price cache): the 17 MB
  exchangeInfo asset list cannot be fetched per keystroke — it must be fetched + trimmed +
  cached server-side. This is the only caching the eval actually needs.

## Cross-System Convention

The idiomatic fix for "swap an external provider without rippling through the domain" is an
**anti-corruption adapter**: preserve the existing module's function signatures
(`getCurrentPrice`, `getMultiplePrices`, `getHistoricalPrice`, `getHistoricalPriceSeries`,
`getPriceForDate`, `searchCoins`), key results by the existing asset id, and confine the
provider mapping to one module. The blast-radius investigation independently arrived at this
(Strategy A), matching the convention. Confirms the swap is a contained seam, not a rewrite.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the deployed app's price data source is
> permanently quota-walled, and the failure is invisible — *not* a missing caching layer.
> The fix is a contained provider swap to Binance behind the existing price-module contract,
> plus surfacing failures; the shared price cache is scale insurance the evaluation does not
> need.

The initial *cause* framing was correct (CoinPaprika IP-quota wall). The reframe is one of
**scope**: the user's proposed direction bundled a shared Supabase price cache that, given a
small-group eval and Binance's per-minute budget, is gold-plating that adds refactor +
testing surface against a 7-day deadline. Keep it out of the eval scope; defer to a later
optimization. The genuinely required pieces are (1) the Binance adapter covering all three
surfaces, (2) a server-side **asset-list** cache (the 17 MB exchangeInfo problem), (3) the
USDT=$1 special case + symbol mapping, and (4) replacing silent-empty with a visible error.

## Confidence

**HIGH** — strong evidence on the blocker (live 402) and the replacement premise (live
Binance headers + docs: per-minute reset), the blast radius is contained (Strategy A,
empty DB), all three surfaces are coverage-verified, and the user's narrowing answers
decisively separated required scope from gold-plating.

One caveat to verify during /10x-implement, not blocking the plan: confirm
`data-api.binance.vision` is reachable **from the deployed Cloudflare Worker region** (it is
AWS Tokyo / CDN-fronted; Binance can change regional behavior). Easy to smoke-test on first
deploy.

## What Changes for /10x-plan

Plan a **contained Binance adapter** (Strategy A: keep CoinPaprika-shaped asset ids as the
canonical persisted key; map id→Binance symbol inside one price module) covering search,
current, and historical, with a server-side asset-list cache, USDT=$1 handling, and visible
error states. **Explicitly exclude** the shared Supabase price cache and any hardening of the
20s live poll from this change — note them as deferred follow-ups. Optimize for surviving the
7-day evaluation, not for scale.

## References

- Source files: `src/lib/coinpaprika.ts:3,19-27,29-54`, `src/pages/api/assets/search.ts`,
  `src/pages/api/prices.ts`, `src/components/portfolio/PortfolioView.tsx:11,80-86`,
  `src/components/portfolio/AssetAutocomplete.tsx:43-51`, `src/lib/format.ts:25-27`,
  `src/lib/schemas.ts:3-7`, `src/components/portfolio/SellAllDialog.tsx:39`,
  `supabase/migrations/20260614213523_create_transactions.sql:10,14`
- Related lessons: `context/foundation/lessons.md` (CoinPaprika boundary unguarded modes;
  364-day historical floor)
- Investigation tasks: #1 (identifier blast radius), #2 (Binance coverage),
  #3 (Binance shared-IP premise)
