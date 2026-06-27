---
starter_id: 10x-astro-starter
package_manager: npm
project_name: vault-view
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Solo-built crypto portfolio tracker (VaultView) with Google OAuth auth on a 5-week timeline targeting small scale. The recommended default for (web-app, js) is 10x Astro Starter — Astro 6 + React 19 + Supabase + Cloudflare — which ships auth, database, and edge deploy out of the box. It clears all four agent-friendly gates: TypeScript-first with Zod schemas at boundaries (typed), file-based routing with island architecture (convention-based), Astro + React are well-represented in training data (popular), and docs are current and versioned (well-documented). Cloudflare Pages is the deployment default; GitHub Actions with auto-deploy-on-merge is the CI shape. Standard path taken — no feature audit, team profile, or self-check needed for the vetted recommendation.

## Pricing API

**Binance public market-data API** — zastąpiło CoinPaprika 2026-06-27 (zob. `context/changes/binance-price-provider/`). CoinPaprika free tier (limit per-IP/miesiąc) był trwale przekroczony ze współdzielonego IP Cloudflare Workers → HTTP 402. Binance ma budżet per-minuta (reset co minutę), odporny na współdzielenie IP.

- Host: `https://data-api.binance.vision/api/v3` — publiczny market-data; `api.binance.com` bywa blokowany w sieci firmowej, ten host nie.
- Klucz API: nie wymagany
- Limity: 6000 weight/min per-IP, reset co minutę (~3000 wywołań ceny/min)
- Ceny bieżące: `/ticker/price?symbol=BTCUSDT` (batch via `?symbols=[...]`)
- Ceny historyczne: `/klines?symbol=...&interval=1d` (close = index [4]); wieloletnia historia
- Lista assetów: `/exchangeInfo` → przefiltrowana do statycznej listy (`src/lib/asset-list.ts`); wyszukiwanie lokalne, bez wywołań sieciowych
- Identyfikator assetu: ticker (BTC, USDT); symbol Binance = `${id}USDT`; stablecoiny (USDT/USDC) wyceniane na $1
- Docs: https://developers.binance.com/docs/binance-spot-api-docs

**Historia: CoinPaprika** (wybrane 2026-06-12, zastąpione 2026-06-27)

- Endpoint: `https://api.coinpaprika.com/v1/`, bez klucza, 20K calls/miesiąc
- Powód odejścia: limit per-IP/miesiąc przekraczany ze współdzielonego IP workerów → 402 (cisza w UI, bo błąd degradował do pustej odpowiedzi)

**Odrzucone alternatywy:**

- CoinGecko — `api.coingecko.com` zablokowane w sieci deweloperskiej; najlepsze docs i community, ale niedostępne
- Yahoo Finance — nieoficjalne endpointy (`query1.finance.yahoo.com`), brak gwarancji stabilności; zachowane jako potencjalny fallback
- CryptoCompare, CoinMarketCap — wymagają klucza API
