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

**Coinbase public API** — zastąpiło Binance 2026-06-29 (zob. `context/changes/coinbase-price-provider/`). Binance zaczęło zwracać HTTP 403 dla egress IP Cloudflare Workers (wszystkie hosty: `data-api.binance.vision`, `api.binance.com`, `api.binance.us`) — `safeFetch` degradował 403 do `null` → „price unavailable" w całym UI. Coinbase ma limity per-sekundę/per-godzinę (reset szybki, odporny na współdzielenie IP) i jest osiągalne z Workera.

- Hosty: `https://api.coinbase.com/v2` (ceny bieżące + historyczne po dacie), `https://api.exchange.coinbase.com` (świece/candles)
- Klucz API: nie wymagany. **User-Agent**: wysyłany przy każdym żądaniu (workerd nie ustawia domyślnego; host candles bywa go wymaga).
- Limity: ~10 000 żądań/h per-IP (retail v2), ~10 żądań/s per-IP (exchange)
- Ceny bieżące: `/v2/prices/{SYM}-USD/spot` → `data.amount`. **Brak batcha** → równoległe wywołania per-symbol.
- Ceny historyczne (data): `/v2/prices/{SYM}-USD/spot?date=YYYY-MM-DD` — okno tylko ~2 lata; dla starszych dat 404, więc fallback na pojedynczą świecę dzienną.
- Seria historyczna: `/products/{SYM}-USD/candles?granularity=86400` — wiersz `[time(s), low, high, open, close, volume]`, close = index [4], czas w **sekundach**, kolejność od najnowszych; limit ~300 świec/żądanie → dzielenie okna na fragmenty ≤300 dni.
- Lista assetów: `/products` (filtr `quote_currency=USD`, `status=online`) → statyczna lista (`src/lib/asset-list.ts`); wyszukiwanie lokalne, bez wywołań sieciowych.
- Identyfikator assetu: ticker (BTC, USDT); symbol Coinbase = `${id}-USD`; stablecoiny (USDT/USDC) wyceniane na $1.
- **WAŻNE**: Coinbase jest zablokowane w sieci deweloperskiej (firewall), ale osiągalne z Workera — odwrotnie niż Binance. Ceny weryfikuj z wdrożonego Workera, nigdy z localhost.
- Docs: https://docs.cdp.coinbase.com/

**Historia: Binance** (wybrane 2026-06-27, zastąpione 2026-06-29)

- Host: `https://data-api.binance.vision/api/v3`, bez klucza
- Powód odejścia: HTTP 403 dla egress IP Workerów (blokada datacenter/region) — ta sama klasa cichej awarii co CoinPaprika

**Historia: CoinPaprika** (wybrane 2026-06-12, zastąpione 2026-06-27)

- Endpoint: `https://api.coinpaprika.com/v1/`, bez klucza, 20K calls/miesiąc
- Powód odejścia: limit per-IP/miesiąc przekraczany ze współdzielonego IP workerów → 402 (cisza w UI, bo błąd degradował do pustej odpowiedzi)

**Odrzucone alternatywy:**

- CoinGecko — `api.coingecko.com` zwraca 403 bez nagłówka User-Agent + rate-limit na współdzielonym IP; najlepsze docs, ale ryzykowne
- Kraken — osiągalne z Workera, ale słabe pokrycie głębokiej historii (zły fit dla starych depozytów i wykresu)
- Yahoo Finance — nieoficjalne endpointy (`query1.finance.yahoo.com`), brak gwarancji stabilności
- CryptoCompare, CoinMarketCap — wymagają klucza API
