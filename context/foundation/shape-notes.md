---
project: "VaultView"
context_type: greenfield
created: 2026-05-28
updated: 2026-05-29
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "Both — data trapped in silos (no consolidated view across platforms) + workflow friction (sell-all, atomic swaps)"
    - topic: "persona scope"
      decision: "Me first, then friends/community — multi-user from day one via Supabase Auth"
    - topic: "competitive insight"
      decision: "Both — no existing tracker nails location-aware consolidation AND frictionless transaction entry (atomic swaps, sell-all auto-fill)"
    - topic: "auth strategy"
      decision: "Google OAuth only for MVP (email/password deferred to v2)"
    - topic: "role model"
      decision: "Flat — all users equal for MVP. Admin panel (user mgmt, stats, asset config) deferred to v2."
    - topic: "transaction model"
      decision: "Unified two-sided model: BUY/SELL/SWAP are all source asset → target asset trades. Type label is UX-only. DEPOSIT and WITHDRAW are one-sided."
    - topic: "withdraw P&L"
      decision: "WITHDRAW realizes P&L for withdrawn amount (tentative — exact pricing mechanism routed to Open Questions)"
  frs_drafted: 13
  quality_check_status: accepted
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 5
  hard_deadline: 2026-07-05
  after_hours_only: false
---

## Vision & Problem Statement

Crypto assets are scattered across multiple exchanges (Binance, Bybit) and wallets (MetaMask, cold wallets) with no single pane of glass to see consolidated positions and P&L. The core pain is twofold: data is trapped in silos (each platform shows only its own slice), and the transaction workflows are full of friction (selling a full position requires manual quantity lookup, swapping crypto-to-crypto requires creating two separate transactions, and the same asset held in multiple locations never appears as one consolidated position).

No existing tracker (CoinGecko Portfolio, CoinMarketCap, Koinly, Delta) nails both location-aware consolidation and frictionless transaction entry. The insight: tagging WHERE each position physically sits (exchange, wallet, cold storage) as a first-class concept — combined with atomic swap recording and sell-all auto-fill — is the gap the market leaves open.

## User & Persona

### Primary persona
Personal crypto investor who actively manages positions across multiple exchanges and wallets. Buys, sells, and swaps crypto regularly. Needs a single consolidated view of all holdings with P&L broken down by asset and by location. Currently stitches together numbers manually across platforms. First user: the builder (you). Designed for multi-user from day one so friends and community members can use it too.

## Access Control

Authentication via Supabase Auth with Google OAuth (one-click sign-in). Email/password deferred to v2. Flat user model — every user has the same capabilities. Each user sees only their own transactions and positions (row-level isolation via Supabase RLS). Admin panel (user management, platform stats, asset configuration) is explicitly deferred to v2; for MVP, the available asset list comes directly from CoinGecko API.

## Success Criteria

### Primary
- User can log in, add all five transaction types (BUY, SELL, SWAP as two-sided trades; DEPOSIT with historical cost basis; WITHDRAW as cash-out with realized P&L) with live CoinGecko API price suggestions (current and historical prices), and see consolidated positions with accurate realized and unrealized P&L across locations.
- Per-asset P&L is viewable in two modes: aggregate average-cost P&L and per-buy breakdown (each purchase treated as a separate position).

### Secondary
- Global "sell all" across all locations in one operation, with per-location target asset and fee customization.

### Guardrails
- P&L calculations must be arithmetically correct — wrong numbers are worse than no numbers. Average Cost method must produce verifiably accurate results.
- User data isolation — no user ever sees another user's transactions or positions. Enforced at the database level via Supabase RLS.

## Timeline acknowledgment
Acknowledged on 2026-05-29: 5-week MVP requires sustained dedication; user accepted.

## Functional Requirements

### Authentication
- FR-001: User can sign up and log in via Google OAuth. Priority: must-have
  > Socrates: Counter-argument considered: "supporting two auth methods (Google + email/password) doubles auth surface area for a personal tracker." Resolution: dropped email/password for MVP. Google OAuth only — simpler and safer. Email/password can be added in v2 if needed.
- FR-002: User can log out. Priority: must-have
  > Socrates: Counter-argument considered: "session timeout might be better than manual logout for a crypto tracker." Resolution: kept manual logout — users expect a logout button. Session timeout can come later.

### Transaction Management
- FR-003: User can add a BUY/SELL/SWAP transaction as a two-sided trade (source asset → target asset), with quantities on both sides, exchange rate (CoinGecko-suggested or manual), fee, date/time, and location label. The type label (BUY/SELL/SWAP) is a user-facing categorization; the P&L engine treats all trades identically: realized P&L on the source asset, new cost basis on the target asset. No fiat support — all trades are crypto-to-crypto (stablecoins like USDT serve as the "cash" side). Priority: must-have
  > Socrates: Counter-argument considered: "forcing every BUY to name a source asset adds friction — users just want to say 'bought 1 BTC at $60k'." Resolution: kept two-sided model. When someone buys BTC at $60k, they paid with USDT or another stablecoin. Both sides must be tracked for accurate P&L across the portfolio. No fiat.
- FR-004: User can use "sell all" when creating a trade to auto-fill the source asset quantity from current holdings at the selected location. Additionally, user can "sell all" of an asset across all locations in one operation, with per-location customization of target asset and fee (e.g., BTC on Binance → USDT, BTC on MetaMask → ETH, each with its own fee). Priority: must-have
  > Socrates: Counter-argument considered: "sell-all at a single location is misleading when user's mental model is 'sell all my BTC' across all locations." Resolution: kept per-location sell-all AND added global sell-all across locations with per-location target asset and fee customization.
- FR-005: User can add a DEPOSIT (one-sided: adds asset quantity at a location). User specifies the original purchase date; the app derives cost basis from CoinGecko's historical price at that date, enabling P&L calculation for deposited assets. Priority: must-have
  > Socrates: Counter-argument considered: "depositing without cost basis makes unrealized P&L impossible to calculate." Resolution: DEPOSIT now requires the original purchase date. App derives cost basis from CoinGecko historical price, so P&L is calculable for all assets including deposits.
- FR-006: User can add a WITHDRAW (one-sided: removes asset quantity from a location, realizes P&L for the withdrawn amount at current market price). WITHDRAW means the user is cashing out of crypto (converting to fiat or leaving the ecosystem), not transferring between tracked locations. Priority: must-have
  > Socrates: Counter-argument considered: "realizing P&L on withdrawal is conceptually wrong — it's just moving crypto." Resolution: WITHDRAW is explicitly an exit from crypto (cash-out), not a transfer. Realized P&L is correct because the asset leaves the portfolio permanently.
- FR-007: User sees a CoinGecko-suggested price (current or historical for the selected date/time) when adding a transaction, and can override it manually. Priority: must-have
  > Socrates: Counter-argument considered: "CoinGecko free API rate limits (10-30 calls/min) could break UX during rapid transaction entry." Resolution: accepted the rate limit risk — personal tracker with low volume. Address if it becomes a problem.

### Portfolio Views
- FR-008: User can view per-asset detail: average cost, total quantity across all locations, current CoinGecko price, unrealized P&L. Priority: must-have
  > Socrates: Counter-argument considered: "unrealized P&L for deposited assets without cost basis is confusing." Resolution: resolved by FR-005 change — deposits now derive cost basis from purchase date. All assets have calculable P&L.
- FR-009: User can view per-asset P&L in two modes: (1) aggregate average-cost P&L per asset (is the whole position in profit?), and (2) per-buy P&L breakdown where each individual purchase is treated as a separate position (like futures positions on exchanges). Priority: must-have
  > Socrates: Counter-argument considered: "per-buy breakdown could be nice-to-have." Resolution: promoted to must-have. Both aggregate and per-buy views are essential — aggregate shows overall position health, per-buy shows which entries are underwater vs profitable. Two display modes.
- FR-010: User can view a summary dashboard: total realized P&L, total unrealized P&L, total fees paid. Flat totals only — no time-series charts for MVP. Priority: must-have
  > Socrates: Counter-argument considered: "flat numbers without time dimension could be misleading." Resolution: kept flat totals for MVP. Time-series P&L charts are a v2 feature.
- FR-011: User can view a list of all transactions with filtering by type, location, and asset. Priority: must-have
  > Socrates: Counter-argument considered: "three filters is over-engineered for MVP." Resolution: kept all three filters — transaction lists grow fast in crypto, filtering from day one prevents the list from becoming unusable.

### Location Management
- FR-012: User can create location labels inline during transaction entry via free-text with autocomplete (type "Binance" and it auto-completes from existing labels or creates a new one). No separate location management screen. Priority: must-have
  > Socrates: Counter-argument considered: "separate location CRUD is overhead." Resolution: simplified to inline free-text with autocomplete. Locations are created on-the-fly during transaction entry.
- FR-013: User can see consolidated holdings per asset across all locations, with per-location breakdown collapsed by default and expandable on demand. Priority: must-have
  > Socrates: Counter-argument considered: "per-location breakdown clutters the view for users who just want the total." Resolution: kept breakdown but collapsed by default. Consolidated total is the primary view; per-location detail is expandable.

## User Stories

### US-01: User adds a trade and sees updated portfolio

- **Given** a logged-in user with at least one location label created
- **When** they select a transaction type (BUY/SELL/SWAP), pick the source and target assets (with CoinGecko autocomplete), enter quantities, accept or override the CoinGecko-suggested price, set a fee, pick date/time and location, and submit
- **Then** the transaction is saved, realized P&L is calculated on the source asset (against its average cost), a new cost basis is created on the target asset, and the portfolio views (per-asset and summary) reflect the updated positions

#### Acceptance Criteria
- CoinGecko price suggestion loads within 2 seconds of selecting asset + date/time
- Manual price override is always available
- Transaction is persisted and immediately visible in both portfolio views

### US-02: User views consolidated portfolio with P&L

- **Given** a logged-in user with multiple transactions across different locations
- **When** they open the per-asset view
- **Then** they see each asset's average cost, total quantity across all locations, current CoinGecko price, and unrealized P&L — with a per-location breakdown showing where each holding sits

#### Acceptance Criteria
- Assets with holdings across multiple locations show a single consolidated row with expandable per-location detail
- Current prices refresh from CoinGecko on page load

### US-03: User sells entire position with sell-all

- **Given** a logged-in user with holdings of asset X at location "Binance"
- **When** they create a SELL trade, select asset X as source, pick location "Binance", and tap "sell all"
- **Then** the source quantity auto-fills with the full holding at that location, and on submit the realized P&L reflects the full position close

#### Acceptance Criteria
- Sell-all quantity matches the exact current holding at that specific location (not the total across all locations)
- If holding is zero, sell-all is disabled or shows a clear message

### US-04: User deposits an existing asset into tracking

- **Given** a logged-in user who holds crypto outside the tracker (e.g., BTC bought 3 months ago on another exchange)
- **When** they create a DEPOSIT, select the asset, enter quantity, specify the original purchase date, pick location label
- **Then** the asset quantity is added to that location with cost basis derived from CoinGecko's historical price at the purchase date, and the portfolio views show the updated holdings with calculable P&L

#### Acceptance Criteria
- App suggests CoinGecko price for the specified purchase date as cost basis
- Deposited assets appear in portfolio views with full P&L (unrealized P&L calculated against derived cost basis)
- Deposit does not affect realized P&L

### US-05: User withdraws an asset from tracking

- **Given** a logged-in user with holdings of asset X at a location
- **When** they create a WITHDRAW, select the asset, enter quantity (or use sell-all), pick location
- **Then** the withdrawn quantity is removed from that location, realized P&L is calculated for the withdrawn amount, and portfolio views reflect the reduced position

#### Acceptance Criteria
- Withdraw quantity cannot exceed current holdings at that location
- Realized P&L is recorded for the withdrawn amount

## Business Logic

VaultView calculates realized and unrealized P&L using the Average Cost method across five crypto transaction types (BUY, SELL, SWAP as two-sided trades; DEPOSIT with historical cost basis; WITHDRAW as cash-out), consolidating positions by asset and location label, with prices sourced from CoinGecko.

The rule consumes: transaction records (type, source/target assets, quantities, exchange rate, fee, date/time, location) and historical/current prices from the CoinGecko API. Location labels are user-defined free-text tags created inline during transaction entry.

The rule produces: per-asset average cost and unrealized P&L (shown in two modes — aggregate and per-buy breakdown), per-transaction realized P&L on source asset disposal, and a summary of total realized P&L, total unrealized P&L, and total fees paid.

The user encounters the output every time they view the portfolio — the P&L engine recalculates from the full transaction history. Every trade (BUY/SELL/SWAP) is a two-sided crypto-to-crypto exchange: the source asset's average cost determines realized P&L, and the exchange price becomes the target asset's cost basis for future unrealized P&L. DEPOSIT derives cost basis from the CoinGecko price at the user-specified original purchase date. WITHDRAW realizes P&L at current market price and removes the asset from tracking permanently.

## Non-Functional Requirements

- P&L calculations must be arithmetically verifiable — the Average Cost computation must produce results that a user can independently reproduce with a spreadsheet from the same transaction inputs.
- A user sees acknowledgement of any form submission within 1 second, and CoinGecko price suggestions load within 3 seconds of selecting an asset and date/time.
- No user's transactions, positions, or P&L data are visible to any other user, under any access path.
- The product remains usable on the latest two major versions of Chrome, Firefox, Edge, and Safari on desktop. No mobile-responsive requirement for MVP.
- Transaction data is retained indefinitely — no automatic deletion or archival of historical transactions.

## Non-Goals

- No fiat currency support (PLN/USD) — all trades are crypto-to-crypto. Stablecoins (USDT, USDC) serve as the "cash" side. Fiat on/off ramp is out of scope for MVP.
- No automatic import from exchanges — all transactions entered manually. API import from Binance, Bybit, MetaMask, etc. is out of scope for MVP.
- No price alerts or notifications — no push notifications, email alerts, or price-triggered actions for MVP.
- No FIFO/LIFO costing methods — Average Cost is the only P&L calculation method for MVP. Alternative methods are a v2 feature.
- No mobile-responsive layout — desktop browsers only for MVP. Mobile experience is a v2 feature.
- No admin panel — user management, platform stats, and asset configuration are deferred to v2 (captured in Access Control).
- No email/password auth — Google OAuth only for MVP (captured in FR-001 Socrates resolution).

## Open Questions

1. **WITHDRAW pricing mechanism** — When a user withdraws an asset, P&L is realized. At what price? Current CoinGecko market price at time of withdrawal? Or user-specified? Owner: user. Block: no (default to current market price, refine if needed).

## Forward: tech-stack

User preferences (informational — not part of PRD, captured for downstream tech-stack selector):
- Framework: Astro 6 + React 19
- Language: TypeScript
- Styling: Tailwind CSS
- Backend/DB: Supabase (auth, database, RLS)
- External API: CoinGecko (free tier — current prices, historical prices, asset list)
- Hosting: Cloudflare Pages
- Testing: Vitest
- CI: GitHub Actions

Scaling note: CoinGecko free API rate limits (10-30 calls/min) may become a bottleneck at 100x user scale. Caching strategy or paid plan would be needed.
