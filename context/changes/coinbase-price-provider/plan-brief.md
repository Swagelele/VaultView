# Price Provider Swap: Binance → Coinbase — Plan Brief

> Full plan: `context/changes/coinbase-price-provider/plan.md`
> Frame brief: `context/changes/coinbase-price-provider/frame.md`

## What & Why

Binance refuses the Cloudflare Worker's egress IP with **HTTP 403** on every host; the
integration is wired and coded correctly, but the upstream provider blocks our datacenter IP.
The fix is a provider swap to **Coinbase** — verified reachable from the Worker for current,
historical-by-date, and candle-series prices — not a Binance wiring fix.

## Starting Point

`src/lib/prices.ts` is the sole price-provider module; its `safeFetch` swallows the 403 to
`null`, surfacing as "price unavailable — enter manually" everywhere. Four consumers call its
public API. `prices.test.ts` mocks Binance shapes. `ASSET_TICKERS` was generated from Binance
USDT pairs.

## Desired End State

Form current + historical (DEPOSIT) prices, portfolio live prices + auto-refresh, and the
history chart all work on the deployed Worker. No consumer signatures change. A future provider
block is visible in `wrangler tail` rather than silent.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Provider | Coinbase | Only candidate reachable from the Worker for all 3 capabilities, no key | Frame |
| Scope | All price surfaces | 403 hits every fetch; one shared code path | Frame |
| Module API | Keep stable | Rewrite internals only → consumers untouched | Plan |
| Batch prices | Parallel per-symbol | Coinbase has no batch endpoint | Plan |
| Asset list | Regenerate from Coinbase | Autocomplete only offers priceable assets | Plan |
| History window | Chunk ≤300-day requests | Preserve current ~1yr chart; Coinbase caps ~300 candles | Plan |
| Observability | Log boundary failures | 2nd silent outage; make the next block visible (lessons.md:19-24) | Plan |
| Tests | Port 1:1 + chunking test | Preserve P&L-protecting boundary coverage | Plan |

## Scope

**In scope:** Coinbase rewrite of `prices.ts` (current, multiple, historical-by-date, candle
series with chunking), User-Agent header, failure logging, test re-point + chunking test, asset
list regeneration, docs + lesson.

**Out of scope:** consumer changes, fiat/cost-basis migration, user-facing banner, Binance
proxy/fallback, shared cross-user cache.

## Architecture / Approach

Internal rewrite behind a stable public API, in two capability slices (current/historical, then
series), each deployable + verifiable on the Worker so the outage is fixed first; list + docs
land last. Two Coinbase hosts: `api.coinbase.com/v2` (spot + dated) and
`api.exchange.coinbase.com` (candles, UA + chunking). Always send a User-Agent.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Adapter core | Form + portfolio prices fixed (current + historical) | Stale-retention contract in `getMultiplePrices` must survive the batch→parallel rewrite |
| 2. Series + chunking | History chart works across ~1yr | Off-by-one in ≤300-day chunk boundaries; seconds-vs-ms time |
| 3. List + docs | Autocomplete = priceable assets; decisions recorded | Regeneration needs a temporary Worker endpoint (dev network can't reach Coinbase) |

**Prerequisites:** Cloudflare deploy access (verification is Worker-only — Coinbase is
firewall-blocked from the dev network).
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- **Local dev cannot fetch prices** (Coinbase blocked from this network) — all verification is on
  the deployed Worker. Inverse of the Binance trap.
- Shared Cloudflare egress IP could in theory hit Coinbase limits, but they reset per-second/hour
  (not a monthly cap like CoinPaprika), so contention self-heals.
- Assets without a Coinbase USD pair degrade gracefully to manual entry.

## Success Criteria (Summary)

- BTC (and other assets) show live + historical prices in the form on prod.
- Portfolio view + history chart populate with no $0 cliff.
- A future provider failure logs to `wrangler tail` instead of failing silently.
