<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Price Provider Swap Binance → Coinbase

- **Plan**: context/changes/coinbase-price-provider/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-06-29
- **Verdict**: APPROVED (with 2 minor warnings)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — getMultiplePrices fans out one fetch per symbol, unbounded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/lib/prices.ts:101-110 ; src/lib/portfolio-history-service.ts:60
- **Detail**: Coinbase has no batch price endpoint, so fetchPrices issues `Promise.all` over one /spot call per uncached symbol with no concurrency cap (Binance used a single ?symbols=[...] batch). A 30-asset portfolio = 30 simultaneous fetches per refresh (every 15-30s); getPortfolioHistory fans out assets × candle-chunks at once. Can brush Coinbase ~10 req/s + workerd subrequest limits. Fine at PRD single-user scale; cache + stablecoin short-circuit blunt it.
- **Fix A ⭐ Recommended**: Document the unbounded fan-out as accepted at current scale.
  - Strength: Honest at scale; no premature complexity; per-second limits self-heal.
  - Tradeoff: Large portfolio could transiently 429.
  - Confidence: HIGH — matches PRD scale.
  - Blind spot: Real eval portfolio sizes unknown.
- **Fix B**: Bound concurrency with a small pool (~5-10) in fetchPrices + history-service.
  - Strength: Removes burst risk.
  - Tradeoff: New helper; slightly slower for big portfolios.
  - Confidence: MED.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (documented in fetchPrices doc comment)

### F2 — Stale "Binance" / dangling USD_PEGGED references in comments

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/prices.ts:30 ; src/lib/schemas.ts:3-5
- **Detail**: parsePrice doc still says "Coerce Binance's string prices". schemas.ts:3-5 says "uppercase Binance tickers" and cross-references "prices.ts USD_PEGGED" — a set that no longer exists (now delegates to isUsdStablecoin). The dangling ref misleads.
- **Fix**: Update prices.ts:30 → "Coinbase's"; fix schemas.ts:3-5 to drop USD_PEGGED reference and say "Coinbase tickers".
- **Decision**: FIXED (prices.ts parsePrice doc + schemas.ts USD_STABLECOINS comment)

### F3 — No boundary validation of ids/date in /api/prices

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/prices.ts
- **Detail**: coinId/date flow into Coinbase URLs. encodeURIComponent + uppercase-`-USD` mapping neutralizes injection (worst case 404 → null), so not exploitable. Optional hardening: validate ids against ASSET_TICKERS and date against ^\d{4}-\d{2}-\d{2}.
- **Fix**: Optional — add input validation at the endpoint.
- **Decision**: FIXED (date regex + id charset filter at api/prices.ts; no strict allowlist, to keep delisted-but-held assets priceable)

### F4 — historicalPriceCache is unbounded (no eviction)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/lib/prices.ts:42
- **Detail**: Module-global Map keyed coinId:day, back-filled from series. workerd isolates short-lived so unlikely to matter; no eviction cap.
- **Fix**: Defer — acceptable given isolate lifetime.
- **Decision**: SKIPPED

### F5 — Candle window boundary style differs: series vs single-day fetch

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/lib/prices.ts:183 vs 244
- **Detail**: fetchDailyCandleClose uses T00:00:00Z..T23:59:59Z; the series uses 00:00 start/end. Both correct, but a latent foot-gun if merged into one helper later.
- **Fix**: No action needed.
- **Decision**: FIXED (comment added to fetchDailyCandleClose noting the intentional boundary divergence)
