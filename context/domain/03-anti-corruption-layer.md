---
title: Anti-Corruption Layer — containing the CoinPaprika coin-id convention behind an AssetId value object
created: 2026-06-23
type: refactor-plan
---

# Anti-Corruption Layer: the CoinPaprika coin-id convention

> A PLAN, not an implementation. Read-only on production code; the only artifact
> written is this document. Every `file:line` below was opened and verified
> against git commit `392ed25` (master).

## TL;DR (the pick)

The obvious candidate — the CoinPaprika **HTTP client** (`src/lib/coinpaprika.ts`)
— is **already a clean ACL** and is correctly left alone (prior research confirmed;
re-verified §1). The worst-leaking dependency is the one thing that client does
**not** contain: the CoinPaprika **coin-id format convention** —
the `{symbol}-{name}` string shape (`usdt-tether`, `btc-bitcoin`, `usdc-usd-coin`).

That vendor convention escapes the client and is **decoded, pattern-matched, and
hardcoded across five layers** — schema, service, two React components, a display
helper — **and is persisted verbatim into the `source_asset` / `target_asset`
varchar columns** of a table whose data is retained indefinitely (PRD: "Transaction
data is retained indefinitely"). Swapping the price provider (the tech-stack doc
explicitly keeps "Yahoo Finance … as a potential fallback") would require touching
all five layers and **migrating stored rows** — the textbook symptom of a missing
ACL.

The fix: a single `AssetId` value object that is the **sole** place that knows the
`{symbol}-{name}` shape and the stablecoin set, plus a narrow `AssetCatalogPort`
that hides the provider behind a domain interface, with `coinpaprika.ts` demoted to
one adapter implementing it.

---

## STEP 0 — Discovery

### Stack & layers (verified)

- Astro 6 SSR + React 19 islands + Supabase + Cloudflare workerd (`package.json:21-44`,
  CLAUDE.md). TypeScript-first; Zod at boundaries.
- Layers in `src/`:
  - **UI** — `src/components/portfolio/*.tsx` (React islands)
  - **API routes** — `src/pages/api/**/*.ts`
  - **Domain/services** — `src/lib/*.ts` (`transaction-service`, `portfolio-service`,
    `pnl-engine`, `schemas`, `format`, `asset-allocation`)
  - **Boundary adapters** — `src/lib/coinpaprika.ts` (price API), `src/lib/supabase.ts` (DB)
  - **Persistence** — `supabase/migrations/*.sql`

### External dependencies (from `package.json`)

`@supabase/ssr`, `@supabase/supabase-js`, `@astrojs/cloudflare`, `astro`, `react`,
`zod`, plus the **non-package** runtime dependency reached only over HTTP:
**CoinPaprika** (`BASE_URL = "https://api.coinpaprika.com/v1"`, `coinpaprika.ts:3`).

### Docs that DECLARE swappability (the intent-vs-code gap)

`context/foundation/tech-stack.md` (Pricing API section) treats the price provider
as **replaceable**:

> "Yahoo Finance — nieoficjalne endpointy …; **zachowane jako potencjalny fallback**"
> "Odrzucone alternatywy: CoinGecko … CryptoCompare, CoinMarketCap"

So the stack doc explicitly contemplates swapping the provider and names a fallback.
The code **honors this only for the HTTP transport** (`coinpaprika.ts` is a clean
ACL for wire types) and **violates it for the id convention** (the `{symbol}-{name}`
string and the stablecoin id set are spread across the app and frozen into the DB).
That intent-vs-code gap is the strongest single signal for the pick (STEP 2).

---

## STEP 1 — Identify leaking dependencies

Each candidate, with **every file that knows it today** (`file:line`, verified).

### Candidate A — CoinPaprika **HTTP/wire client** → already isolated (do NOT pick)

Vendor wire types (`SearchCurrency`/`SearchResponse`, `TickerResponse`,
`HistoricalTick`) are **function-local and unexported** (`coinpaprika.ts:30-41`,
`:60-62`, `:136-139`); callers see only app types (`CoinSearchResult`,
`PriceLookupResult`, `number | null`). Importers — **4, none in UI**:

- `src/lib/portfolio-service.ts:5` (`getMultiplePrices`)
- `src/lib/transaction-service.ts:4` (`getPriceForDate`, `getMultiplePrices`)
- `src/pages/api/prices.ts:4` (`getMultiplePrices`, `getHistoricalPrice`)
- `src/pages/api/assets/search.ts:4` (`searchCoins`)

**Verdict:** clean ACL for the *transport*. Re-confirmed. Not the leak.

### Candidate B — CoinPaprika **coin-id convention** (`{symbol}-{name}` + stablecoin set) → THE LEAK

The id *string shape* and the hardcoded stablecoin ids are a vendor concern that
`coinpaprika.ts` does **not** own. Files that know it today:

**The convention defined / pattern-matched:**
- `src/lib/schemas.ts:3` — `USD_STABLECOINS = ["usdt-tether", "usdc-usd-coin"]` (hardcoded vendor ids)
- `src/lib/schemas.ts:5-7` — `isUsdStablecoin(coinId)`
- `src/lib/schemas.ts:97-101` — sell-all target gate + the literal ids in the error message
- `src/lib/format.ts:25-27` — `symbolFromId(id) = id.split("-")[0]?.toUpperCase()` — **decodes the `{symbol}-{name}` shape**

**The convention consumed (service):**
- `src/lib/transaction-service.ts:3` (imports `isUsdStablecoin`), `:68`, `:73`, `:75`, `:267` — stablecoin branching that drives **price = $1** and P&L
- `src/lib/portfolio-service.ts:6,38` — `symbolFromId(s.asset)` (display symbol)

**The convention consumed (UI — Candidate A never reaches UI; this does):**
- `src/components/portfolio/TransactionForm.tsx:7` (import), `:66`, `:95`, `:118`, `:137`, `:178`, `:209`, `:277`, `:657` — **8 inline `USD_STABLECOINS.includes(...)` decisions** in a client island
- `src/components/portfolio/SellAllDialog.tsx:7` (import), `:39` `targetAsset: "usdt-tether"`, `:40` `targetSymbol: "USDT"`, `:169` `filterIds={USD_STABLECOINS}` — **hardcoded vendor id + symbol in UI state**
- `src/components/portfolio/TransactionList.tsx:6,96,163,204,208` — `symbolFromId(...)` for sort, filter labels, row rendering

**The convention persisted (the durable leak):**
- `supabase/migrations/20260614213523_create_transactions.sql:10,14` — `source_asset varchar`, `target_asset varchar` store the **raw CoinPaprika id**; `:57-58` index on them. The insert literal writes them straight through (`transaction-service.ts:146,148`). PRD: data retained indefinitely → **the vendor convention is frozen into history.**

**Duplicated reconstruction of the convention** (a classic leak signal):
- `symbolFromId` exists once in `format.ts:25` but its docstring states it
  "**Mirrors the inline derivation in portfolio-service.ts**" — i.e. the same
  `split("-")[0].toUpperCase()` logic was written twice; `format.ts` is the
  extraction of a copy. `SellAllDialog.tsx:39-40` hardcodes both the id
  (`usdt-tether`) **and** its symbol (`USDT`) instead of deriving one from the other.

### Candidate C — untyped Supabase client (`@supabase/supabase-js`)

- `src/lib/supabase.ts:1,9` — `createServerClient(...)` with **no `<Database>` generic**
- Service signatures typed `SupabaseClient` (untyped): `transaction-service.ts:1,14,95,168,241,280,314`; `portfolio-service.ts:1,15`
- 3 `as Transaction` / `as Transaction[]` casts + 1 `eslint-disable` (`transaction-service.ts:157,164,238,252`)
- Importers also: `src/env.d.ts:3`, 8 API routes (`createClient(...)`), `tests/integration/clients.ts` (already hand-types via `IntegrationDatabase`)

**Verdict:** real debt — but **already an owned, planned fix** (D1 in
`context/changes/refactor-opportunities/research.md`, ranked #1, with a Strangler-Fig
path via `supabase gen types`). It is a *typing* gap, not a *leaking domain concept*:
the Supabase shape does not escape the service into the UI (no component imports
`@supabase/*` except the `User` type in `env.d.ts:3`). Excluded here to avoid
duplicating an existing tracked change and because it is less of a *boundary* leak
than Candidate B (see STEP 2 axis (a)).

### Candidate D — Astro / Cloudflare runtime, `zod`, `ts`

Framework substrate, not a swappable domain dependency; no domain signatures carry
their types. Not leaks. (Cloudflare workerd constraint is honored — no Node APIs in
server code.)

---

## STEP 2 — Classify & pick #1

| Axis | B — coin-id convention | C — untyped Supabase | A — CoinPaprika client |
|---|---|---|---|
| (a) layers/files touched | **5 layers** (UI×3, service×2, schema, format, **+ DB columns**); ~7 prod files, ~20 sites | 2 layers (service, adapter); UI untouched | 1 file (already contained) |
| (b) swap cost today | **High** — change provider id format ⇒ edit all 5 layers **+ migrate stored varchar history** | Medium — typing migration, code compiles each step | Low — internal to one file |
| (c) doc declares swappability code doesn't honor | **YES** — tech-stack keeps Yahoo as fallback; code honors transport only, not id shape | No doc declares the client should stay untyped | N/A — honored |
| Already owned/planned? | **No** | **Yes** (D1, ranked #1) | n/a (deliberately left clean) |

**Pick: Candidate B — the CoinPaprika coin-id convention.** It is the worst because
it scores highest on every axis: it crosses the **most** layers (uniquely including
the **client bundle** and the **persistence** layer), it is the **only** candidate
whose swap forces a **data migration**, and it is the **only** candidate with a
documented intent-vs-code gap (the stack doc plans a provider swap the code can't
absorb). Candidate C is genuine debt but is already an owned change and stays
server-side; Candidate A is the clean ACL we explicitly refuse to rebuild.

> Honest finding restated: *the obvious candidate (`coinpaprika.ts`) is already
> isolated; the worst remaining leak is the id convention that slips past it.*

---

## STEP 3 — Diagnose (duplication + boundary leaks)

### Leak 3.1 — vendor literals in the schema, re-decided in the client bundle

`USD_STABLECOINS = ["usdt-tether", "usdc-usd-coin"]` (`schemas.ts:3`) is a list of
**CoinPaprika-specific ids**. It is imported into **two React client islands**
(`TransactionForm.tsx:7`, `SellAllDialog.tsx:7`) and the `.includes(...)` check is
inlined **8 times** in `TransactionForm.tsx` (`:66,:95,:118,:137,:178,:209,:277,:657`).
The vendor's id format is therefore shipped to the **browser** and the
"is this cash?" rule is re-implemented per call site rather than asked of one object.

### Leak 3.2 — the `{symbol}-{name}` shape decoded in 3 places

`symbolFromId(id) = id.split("-")[0]?.toUpperCase()` (`format.ts:25-27`) hard-codes
the CoinPaprika id grammar. Its own docstring admits duplication:

> "Mirrors the inline derivation in portfolio-service.ts so the list and portfolio stay consistent."

Call sites: `portfolio-service.ts:38`, `TransactionList.tsx:96,163,204,208`. A
provider whose ids are *not* `{symbol}-{name}` (e.g. plain `BTC`, or a UUID) breaks
**display** silently — `split("-")[0]` would just return the whole id uppercased,
showing `BTC-USD` as the "symbol". No type or test guards the assumption.

### Leak 3.3 — vendor id + symbol hardcoded in UI state

`SellAllDialog.tsx:39-40` seeds row state with `targetAsset: "usdt-tether"` and
`targetSymbol: "USDT"` — a vendor id and its decoded symbol, written by hand, in a
component. Provider swap ⇒ edit component literals.

### Leak 3.4 — DANGEROUS: the convention is frozen into persistence

`source_asset`/`target_asset` are plain `varchar` (`migration:10,14`), written
verbatim from the parsed input (`transaction-service.ts:146,148`) and **indexed**
(`migration:57-58`). Because P&L is **replayed from full history on every read**
(`pnl-engine`), every stored row's asset id must remain interpretable by whatever
provider is active. Swapping providers doesn't just change new code — it **orphans
existing rows** unless their ids are migrated. This is the leak that turns a
provider swap from a refactor into a data-migration project.

### Leak 3.5 — intent-vs-code, quoted

Stack doc declares the provider swappable and names Yahoo as the kept fallback
(STEP 0). The code honors that for wire types only. The id convention has no ACL, so
the declared swap is not actually achievable without the 5-layer + migration churn
above. **Code does not honor the documented swappability.**

---

## STEP 4 — Design the ACL

Two collaborating pieces: a **value object** that owns the id *shape* and the
*stablecoin* fact, and a **port + adapter** that owns the provider *catalog* lookups.
The rest of the app speaks only `AssetId` and `AssetCatalogPort`.

### 4.1 `AssetId` value object — the SOLE owner of the `{symbol}-{name}` shape

New file: `src/domain/asset-id.ts` (note: a *value object*, immutable, no I/O).

```ts
// The ONLY module allowed to know the CoinPaprika id grammar `{symbol}-{name}`
// and the concrete stablecoin id set. Everything else depends on AssetId, never
// on raw strings or `USD_STABLECOINS`.

export class AssetId {
  private constructor(
    /** raw provider id exactly as stored / sent to the price provider, e.g. "usdt-tether" */
    readonly raw: string,
  ) {}

  /** Parse from a stored DB value or a provider id. Trims/normalizes; rejects empty. */
  static fromStored(value: string): AssetId           // throws/Result on "" — single validation point
  /** Build from a catalog hit (provider already gave us a canonical id). */
  static fromCatalog(id: string): AssetId

  /** Display symbol — the SOLE home of `split("-")[0]`. Replaces symbolFromId + the dup. */
  get symbol(): string                                // "usdt-tether" -> "USDT"

  /** The stablecoin / "cash" fact — replaces USD_STABLECOINS + isUsdStablecoin. */
  get isUsdStablecoin(): boolean                      // membership test, normalized

  equals(other: AssetId): boolean
  toString(): string                                  // === raw, for persistence
}

// Module-private — the ONLY place the literal vendor ids live:
const USD_STABLECOIN_IDS = new Set(["usdt-tether", "usdc-usd-coin"]);
```

Pseudocode for the two leak-bearing operations:

```
get symbol():            return this.raw.split("-")[0]?.toUpperCase() ?? this.raw.toUpperCase()
get isUsdStablecoin():   return USD_STABLECOIN_IDS.has(this.raw.toLowerCase())
```

Mapping to/from persistence: `AssetId.fromStored(row.source_asset)` on read;
`assetId.toString()` (= `raw`) on write — the value object is the round-trip seam,
so a future provider migration changes **one** parse/serialize pair, not 20 sites.

### 4.2 `AssetCatalogPort` — narrow domain interface (hides the provider)

New file: `src/domain/asset-catalog.port.ts`.

```ts
import type { AssetId } from "@/domain/asset-id";

export interface AssetSearchHit { id: AssetId; name: string; symbol: string; rank: number; isActive: boolean; }

/** Domain-facing catalog. No vendor types, no URLs, no id-format knowledge leaks through. */
export interface AssetCatalogPort {
  search(query: string): Promise<AssetSearchHit[]>;
  /** The set of ids the domain treats as "cash". Lets the rule come FROM the catalog, not a literal. */
  stablecoinIds(): readonly AssetId[];
}
```

(Price lookups already have a clean boundary in `coinpaprika.ts`; the port focuses
on the **catalog / id** concerns that currently leak. Price methods may be folded in
later but are out of scope — don't rebuild the working ACL.)

### 4.3 Adapter — `coinpaprika.ts` implements the port

`src/lib/coinpaprika.ts` (existing, already clean) gains a thin
`CoinPaprikaCatalog implements AssetCatalogPort`:

```ts
export class CoinPaprikaCatalog implements AssetCatalogPort {
  async search(q: string) {
    const hits = await searchCoins(q);                 // existing fn, unchanged
    return hits.map(h => ({ id: AssetId.fromCatalog(h.id), name: h.name, symbol: h.symbol, rank: h.rank, isActive: h.is_active }));
  }
  stablecoinIds() { return [AssetId.fromCatalog("usdt-tether"), AssetId.fromCatalog("usdc-usd-coin")]; }
}
```

Now the literal ids live in **two** owned places only: `AssetId`'s private set
(the domain fact) and the adapter (the provider's spelling of that fact) — both
inside the ACL boundary, neither in a schema, service, or component.

### 4.4 What the rest of the code knows after

- `schemas.ts` — drops `USD_STABLECOINS`/`isUsdStablecoin`; sell-all gate asks
  `AssetId.fromStored(row.target_asset).isUsdStablecoin`.
- `transaction-service.ts` — `isUsdStablecoin(sourceAsset)` → `AssetId.fromStored(sourceAsset).isUsdStablecoin`.
- `portfolio-service.ts` / `TransactionList.tsx` — `symbolFromId(x)` → `AssetId.fromStored(x).symbol`.
- `TransactionForm.tsx` / `SellAllDialog.tsx` — `USD_STABLECOINS.includes(a)` →
  `AssetId.fromStored(a).isUsdStablecoin`; the SellAll default comes from
  `catalog.stablecoinIds()[0]`, not the literal `"usdt-tether"`.
- `format.ts` — `symbolFromId` deleted (its one true behavior now lives on `AssetId.symbol`).

---

## STEP 5 — Isolation proof + before/after

### Checkable success criterion (the one grep that must pass)

After the refactor, the vendor id grammar and the stablecoin literals exist **only**
inside the ACL (`src/domain/` + the adapter `src/lib/coinpaprika.ts`). Run:

```bash
# (1) the literal vendor stablecoin ids — must return ONLY asset-id.ts and coinpaprika.ts
rg -n 'usdt-tether|usdc-usd-coin|USD_STABLECOINS' src --glob '!**/*.test.ts'

# (2) the id-grammar decode — must return ONLY src/domain/asset-id.ts
rg -n 'split\("-"\)\s*\[0\]|symbolFromId' src --glob '!**/*.test.ts'
```

**PASS** = every hit's path is `src/domain/asset-id.ts` or `src/lib/coinpaprika.ts`
(plus test files, which are excluded). Any hit under `src/components/`,
`src/pages/`, `src/lib/schemas.ts`, `src/lib/portfolio-service.ts`,
`src/lib/transaction-service.ts`, or `src/lib/format.ts` = **FAIL**.

### Who knows the dependency — before vs after

| File | Before (verified `file:line`) | After |
|---|---|---|
| `src/lib/schemas.ts` | `:3,5-7,97-101` | — (uses `AssetId`) |
| `src/lib/format.ts` | `:25-27` `symbolFromId` | — (deleted) |
| `src/lib/transaction-service.ts` | `:3,68,73,75,267` | — (uses `AssetId`) |
| `src/lib/portfolio-service.ts` | `:6,38` | — (uses `AssetId`) |
| `src/components/portfolio/TransactionForm.tsx` | `:7,66,95,118,137,178,209,277,657` | — (uses `AssetId`) |
| `src/components/portfolio/SellAllDialog.tsx` | `:7,39,40,169` | — (uses port + `AssetId`) |
| `src/components/portfolio/TransactionList.tsx` | `:6,96,163,204,208` | — (uses `AssetId`) |
| `src/domain/asset-id.ts` | (new) | **sole owner of shape + stablecoin set** |
| `src/lib/coinpaprika.ts` | wire types only (clean) | + `CoinPaprikaCatalog` adapter (provider id spelling) |

### Before/after for the duplicated spots

- **Symbol decode (Leak 3.2):** before — `split("-")[0].toUpperCase()` in
  `format.ts:26` *and* (per its docstring) inline in portfolio-service; after — one
  `get symbol()` on `AssetId`. Call sites read `AssetId.fromStored(x).symbol`.
- **Stablecoin rule (Leak 3.1):** before — `USD_STABLECOINS.includes(...)` repeated
  8× in `TransactionForm.tsx` + in `schemas.ts` + `transaction-service.ts`; after —
  `.isUsdStablecoin` on a value object; the literal set lives once in `AssetId` and
  once (as the provider's spelling) in the adapter.
- **Hardcoded id+symbol (Leak 3.3):** before — `SellAllDialog.tsx:39-40`
  `"usdt-tether"` / `"USDT"`; after — `const cash = catalog.stablecoinIds()[0];
  { targetAsset: cash.raw, targetSymbol: cash.symbol }` (symbol derived, not typed twice).

---

## STEP 6 — Phased plan (per repo conventions)

> Strangler-Fig, one compile-clean commit per phase. Path alias `@/` only
> (CLAUDE.md). No relative imports. Each phase is independently shippable; CI
> `build` (= `tsc`) is the gate. Pair with `npm test` locally each phase
> (note: `context/changes/refactor-opportunities/research.md` flags **CI runs no
> tests** — keep the suite green locally; consider proposing a `npm test` CI step
> as a sibling change, out of scope here).

**Phase 0 — Introduce `AssetId` (pure additive, zero consumers).**
Create `src/domain/asset-id.ts` + `src/domain/asset-id.test.ts` covering: `symbol`
for `usdt-tether`→`USDT`, `btc-bitcoin`→`BTC`, id with no `-`, empty input;
`isUsdStablecoin` for both stablecoins + a non-stablecoin + case-insensitivity;
`fromStored`/`toString` round-trip. Commit unused. `git`: `feat(domain): add AssetId value object (ACL for coin-id convention)`.

**Phase 1 — Route display through `AssetId.symbol`.**
Replace `symbolFromId` usages in `portfolio-service.ts:38` and
`TransactionList.tsx:96,163,204,208` with `AssetId.fromStored(x).symbol`. Delete
`symbolFromId` from `format.ts` (and its test). Low risk — pure display; existing
portfolio/list tests cover it. `refactor(format): derive asset symbol via AssetId, drop symbolFromId`.

**Phase 2 — Route the stablecoin rule through `AssetId.isUsdStablecoin` (server).**
`transaction-service.ts:68,73,75,267` and `schemas.ts:97` switch to
`AssetId.fromStored(x).isUsdStablecoin`. Keep `USD_STABLECOINS` exported **temporarily**
for the UI (removed in Phase 3) to keep each commit compiling. Covered by
`schemas.test.ts` + `transaction-service.test.ts`. `refactor(transactions): stablecoin rule via AssetId`.

**Phase 3 — Route the UI + remove the literals from the bundle.**
`TransactionForm.tsx` (8 sites) and `SellAllDialog.tsx:39-40,169` switch to
`AssetId`; `SellAllDialog` default seeds from the catalog port. Then delete
`USD_STABLECOINS` + `isUsdStablecoin` from `schemas.ts`. The success-criterion greps
(STEP 5) now pass. `refactor(ui): consume AssetId; remove USD_STABLECOINS from islands`.

**Phase 4 — Introduce `AssetCatalogPort` + `CoinPaprikaCatalog` adapter.**
Add `src/domain/asset-catalog.port.ts`; implement `CoinPaprikaCatalog` in
`coinpaprika.ts`; point `src/pages/api/assets/search.ts` and `SellAllDialog`'s
default at the port. `feat(domain): AssetCatalogPort + CoinPaprika adapter`.

**Phase 5 — Closeout.** Update `context/foundation/roadmap.md` per CLAUDE.md
closeout rule if a roadmap item matches; otherwise note the ACL in the change's
epilogue. Re-run the STEP 5 greps and paste the PASS output into the epilogue.

**Deferred / out of scope (named, not done):**
- The untyped Supabase client (Candidate C / D1) — already an owned, ranked change.
- The two CoinPaprika runtime guards (`isFinite` + `AbortController`, `lessons.md`)
  — deliberate deferral; do not fold in.
- **Stored-data migration** — making historical `source_asset`/`target_asset`
  provider-agnostic (Leak 3.4) is the deepest part of the leak and a separate,
  larger change; this plan contains the *code* leak so that a future provider swap
  is a one-adapter + one-migration job instead of a 20-site rewrite.
