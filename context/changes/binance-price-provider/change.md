---
change_id: binance-price-provider
title: "Swap price provider CoinPaprika → Binance public market-data"
status: implemented
created: 2026-06-27
updated: 2026-06-27
archived_at: null
---

## Notes

Production price/asset data is broken: CoinPaprika's keyless free tier (20k calls/month, rate-limited by origin IP) is permanently over quota from the deployed Worker's shared Cloudflare IP → HTTP 402, swallowed silently into empty UI. Fix: swap the price provider to Binance's public market-data host `data-api.binance.vision` (reachable where `api.binance.com` is firewall-blocked; per-minute weight budget that self-heals, unlike a monthly cap). Covers asset search, current prices, and historical prices. Framed in frame.md — shared price cache deferred as gold-plating for a small-group evaluation. Hard deadline: evaluation in 7 days (≈2026-07-04).
