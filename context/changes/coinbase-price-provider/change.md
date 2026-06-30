---
change_id: coinbase-price-provider
title: "Swap price provider Binance → Coinbase (Worker egress IP-blocked by Binance)"
status: impl_reviewed
created: 2026-06-29
updated: 2026-06-29
---

## Notes

Production prices are broken again: Binance (data-api.binance.vision, api.binance.com,
api.binance.us) all return HTTP 403 to the deployed Cloudflare Worker's egress IP —
confirmed live from prod via a temporary diagnostic endpoint (cf-ray …-PRG, Prague PoP).
`safeFetch` swallows the 403 to `null`, surfacing as "price unavailable — enter manually"
in the New Transaction form and blank prices across all portfolio surfaces. Same IP-block
failure class that killed CoinPaprika (402 over-quota).

Fix: swap the provider to Coinbase, confirmed reachable from the Worker for all three
needed capabilities — current price (`/v2/prices/{SYM}-USD/spot`), arbitrary historical
date for DEPOSIT cost basis (`/v2/prices/{SYM}-USD/spot?date=YYYY-MM-DD`), and daily candle
series for the portfolio history chart (`api.exchange.coinbase.com/products/{SYM}-USD/candles`,
requires a User-Agent header). No API key. Pair format `${id}USDT` → `${id}-USD`; stablecoins
stay pinned to $1; the static asset list is unaffected.

Framed in frame.md. Scope confirmed: all price surfaces (form + portfolio live/auto-refresh +
history chart). Hard deadline: evaluation ≈2026-07-04.
