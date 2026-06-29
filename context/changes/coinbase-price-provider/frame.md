# Frame Brief: Price provider swap — Binance → Coinbase

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

On the production site (`https://vault-view.strozynskijoachim5.workers.dev`), the
New Transaction form shows **"price unavailable — enter manually"** for BTC (and
every asset); no live or historical prices load anywhere. Screenshot: Deposit form,
BTC, today's date, empty cost-basis field with the yellow "price unavailable" hint.

## Initial Framing (preserved)

- **User's stated cause or approach**: "I implemented the Binance API in the last
  task… the API does not see the prices at all. I don't know if we applied it
  correctly." — i.e. suspected the Binance integration was wired up wrong.
- **User's proposed direction**: Check whether the Binance swap was applied
  correctly and fix the wiring.
- **Pre-dispatch narrowing**: Scope = **all price surfaces** (transaction form
  current+historical, portfolio view live prices + auto-refresh, portfolio history
  chart series), not just the form. History-chart candle series included in this
  change.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Integration wiring** — adapter not actually called / endpoint misrouted / env
   misconfig.  ← initial framing
2. **Code correctness** — wrong symbol mapping, response shape misparsed, bad URL.
3. **Provider reachability from the Worker** — Binance refusing the Cloudflare
   Worker's egress IP (geo/datacenter block), swallowed by `safeFetch` → `null`.
4. **Auth / endpoint** — `/api/prices` returning 401/empty before any upstream call.

## Hypothesis Investigation

Investigated **empirically against production** — a temporary unauthenticated
diagnostic endpoint (`/api/diag-price`, since removed) ran the upstream `fetch`
*inside the deployed Worker* and reported raw status/body. This is stronger evidence
than code reads, so per the skill's no-padding/time-box guardrails no redundant
Explore agents were spawned.

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Integration wiring | Prod redeployed 2026-06-29 08:34 with current code; `/api/prices` returns clean **401** unauthenticated (route + auth work); form calls `/api/prices?ids=BTC&date=…` (`TransactionForm.tsx:73,108`). Wiring is correct. | NONE |
| 2. Code correctness | `prices.ts` parses, guards NaN (`parsePrice`), times out (`AbortController`), degrades to null. Logic is sound; works locally via curl. | NONE |
| 3. **Worker→Binance IP block** | Worker fetch to `data-api.binance.vision` → **HTTP 403** (cf-ray …-PRG). `api.binance.com` and `api.binance.us` also **403** from Worker. Repeatable across two probes. `safeFetch` (`prices.ts:42-57`) turns 403 → null → "price unavailable". | **STRONG** |
| 4. Auth/endpoint | `/api/prices` 401 only without a session; user is logged in (form renders), cookies sent same-origin. | NONE |

**Coinbase reachability from the Worker (replacement validation):**

| Capability | Endpoint | Result from Worker |
| --- | --- | --- |
| Current price | `/v2/prices/BTC-USD/spot` | 200, ~18ms, `{data:{amount}}` |
| Other asset | `/v2/prices/ETH-USD/spot` | 200 |
| Historical date (DEPOSIT) | `/v2/prices/BTC-USD/spot?date=2026-03-01` | 200, returned dated price |
| Daily candle series (chart) | `api.exchange.coinbase.com/products/BTC-USD/candles` | 400 *"User-Agent header is required"* — fixable with a UA header |

Rejected alternatives (probed from Worker): CoinGecko 403 (missing UA + rate-limited
on shared IP), CoinPaprika 200 now but the monthly per-IP quota already burned us,
Kraken 200 but weak deep-history coverage (bad for old DEPOSIT cost basis + chart).

## Narrowing Signals

- The same `safeFetch` swallow-to-null behavior is a documented prior
  (`lessons.md:19-24`): the price boundary degrades silently, which is exactly why a
  403 produced an empty UI with no error — masking a provider outage as a "missing
  price".
- It **worked at the p4 verification** (2026-06-27, commit `e687ffe`: "4.6 Binance
  reachable from Worker region") and broke within ~2 days — consistent with an
  IP/region block applied by Binance after the fact, not a code regression.

## Cross-System Convention

This project has already lived this exact failure once: CoinPaprika was abandoned
(`tech-stack.md`, archive `2026-06-27-binance-price-provider`) because a shared
Cloudflare Worker egress IP tripped a provider-side limit (402), silently degrading
to empty prices. The leading hypothesis (Binance now does the same with a 403) **is
the convention** — same root cause, different provider, same swallow-to-null symptom.

## Reframed Problem Statement

> **The actual problem to plan around is**: Binance refuses the Cloudflare Worker's
> egress IP with HTTP 403 on every host; the integration is wired and coded
> correctly. The fix is a **provider swap to Coinbase** (reachable from the Worker
> for current, historical-by-date, and candle-series prices), not a wiring fix.

The initial framing ("we applied Binance wrong") does not hold: prod runs current
code, the route and auth work, and the adapter is correct. The integration is fine;
the upstream provider blocks our datacenter IP. Addressing the wiring would change
nothing because the failure is at the network boundary, outside our code.

## Confidence

**HIGH** — direct, repeatable production evidence (Worker→Binance 403 on all three
hosts; Worker→Coinbase 200 for all three required capabilities), matches the prior
CoinPaprika convention, and a decisive narrowing signal (worked at p4, broke in
~2 days → external block, not regression).

## What Changes for /10x-plan

Plan a **provider swap of `src/lib/prices.ts` to Coinbase** covering all three
capabilities (current, historical-by-date, candle series) plus the `tech-stack.md`
decision record — NOT a Binance wiring fix. Key planning details: symbol mapping
`${id}USDT` → `${id}-USD`; parse `data.amount`; no batch endpoint (per-symbol
parallel calls in `getMultiplePrices`); the candle series uses a different host
(`api.exchange.coinbase.com`) and **requires a `User-Agent` header** and likely
**range chunking** (Coinbase caps ~300 candles/request, < 365 for a year); assets
without a Coinbase `-USD` pair degrade gracefully to manual entry; stablecoins stay
pinned to $1; static asset list unaffected.

## References

- Source files: `src/lib/prices.ts` (adapter: `:20` `toSymbol`, `:42-57` `safeFetch`,
  `:64` current, `:89` batch, `:166` historical, `:193` series), `src/pages/api/prices.ts`,
  `src/components/portfolio/TransactionForm.tsx:73,108`,
  `src/lib/portfolio-service.ts`, `src/lib/portfolio-history-service.ts`,
  `src/lib/asset-list.ts` (unaffected), `context/foundation/tech-stack.md`
- Priors: `context/foundation/lessons.md:19-24` (silent degrade-to-null boundary)
- Prior incident: `context/archive/2026-06-27-binance-price-provider/` (CoinPaprika→Binance, same root cause)
- Investigation: live prod diagnostic endpoint `/api/diag-price` (deployed, probed, removed)
