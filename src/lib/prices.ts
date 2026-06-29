import type { CoinSearchResult, PriceLookupResult } from "@/types";
import { searchAssetList } from "@/lib/asset-list";
import { isUsdStablecoin } from "@/lib/schemas";

// Coinbase retail price host. Read-only, no API key, generous per-second/per-hour limits (resilient
// to shared-IP contention, unlike CoinPaprika's monthly cap or Binance's datacenter-IP 403). NOTE:
// Coinbase is firewall-blocked from some dev networks but reachable from the Cloudflare Worker —
// the inverse of Binance — so price reachability is only verifiable from the deployed Worker, never
// localhost. Canonical asset ids are uppercase tickers (BTC), mapped to a Coinbase USD product as
// `${id}-USD`. The candle series (getHistoricalPriceSeries) uses a different host — see there.
const BASE_URL = "https://api.coinbase.com/v2";

// Sent on every request: workerd's fetch sends no User-Agent by default, and Coinbase's candle host
// intermittently rejects UA-less requests with 400. Harmless on the retail host.
const USER_AGENT = "VaultView/1.0";

// Abort a hung upstream socket rather than hanging the request (closes a documented boundary gap).
const FETCH_TIMEOUT_MS = 8_000;

export const CURRENT_PRICE_TTL_MS = 120_000;

// Stablecoins are priced at a constant $1: there is no `USDTUSDT` pair, and pinning the stablecoins
// to $1 keeps the adapter consistent with the P&L engine (which treats them as exactly $1) rather
// than showing a market 1.001 in one view and 1.00 in another. `isUsdStablecoin` (schemas.ts) is the
// single source of truth for which assets are USD-pegged — do not duplicate the list here.
function toSymbol(id: string): string {
  return `${id.toUpperCase()}-USD`;
}

/** Coerce Binance's string prices to a finite number, or null. Guards against NaN/Infinity. */
function parsePrice(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) ? n : null;
}

interface CacheEntry {
  price: number;
  fetchedAt: number;
}

const currentPriceCache = new Map<string, CacheEntry>();
const historicalPriceCache = new Map<string, number>();

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CURRENT_PRICE_TTL_MS;
}

/** Fetch + parse JSON, degrading every failure (non-200, network throw, timeout) to null. Logs the
 *  failure first: a silent degrade-to-null is exactly why the CoinPaprika 402 and Binance 403 IP
 *  blocks were invisible — a `wrangler tail` line makes the next provider outage diagnosable. */
async function safeFetch<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!res.ok) {
      // eslint-disable-next-line no-console -- deliberate boundary observability (see fn doc)
      console.warn(`[prices] upstream ${res.status} for ${url}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    // eslint-disable-next-line no-console -- deliberate boundary observability (see fn doc)
    console.warn(`[prices] fetch failed for ${url}: ${String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Asset autocomplete — searches the committed static list, no network call. */
export function searchCoins(query: string): Promise<CoinSearchResult[]> {
  return Promise.resolve(searchAssetList(query));
}

export async function getCurrentPrice(coinId: string): Promise<number | null> {
  if (!coinId) return null;
  if (isUsdStablecoin(coinId)) return 1;

  const cached = currentPriceCache.get(coinId);
  if (cached && isFresh(cached)) return cached.price;

  interface SpotResponse {
    data?: { amount?: string };
  }

  const data = await safeFetch<SpotResponse>(`${BASE_URL}/prices/${encodeURIComponent(toSymbol(coinId))}/spot`);
  // An unknown product returns a non-200 (degraded to null by safeFetch) — `data.amount` absent → null.
  const price = data?.data?.amount !== undefined ? parsePrice(data.data.amount) : null;
  if (price !== null) {
    currentPriceCache.set(coinId, { price, fetchedAt: Date.now() });
  }
  return price;
}

/** Fetch the given ids' USD prices, one Coinbase `/spot` call per symbol, concurrently. Coinbase
 *  has no batch price endpoint; per-symbol isolation means one unknown/delisted ticker can't blank
 *  the rest. A failed symbol is simply omitted from the result. */
async function fetchPrices(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (ids.length === 0) return out;

  const results = await Promise.all(ids.map((id) => getCurrentPrice(id).then((p) => [id, p] as const)));
  for (const [id, price] of results) {
    if (price !== null) out[id] = price;
  }
  return out;
}

export async function getMultiplePrices(coinIds: string[]): Promise<PriceLookupResult> {
  if (coinIds.length === 0) {
    return { prices: {}, stale: false, updated_at: null };
  }

  const fresh: Record<string, number> = {};
  const staleEntries: Record<string, number> = {};
  const toFetch: string[] = [];

  for (const id of coinIds) {
    if (!id) continue;
    if (isUsdStablecoin(id)) {
      fresh[id] = 1;
      continue;
    }
    const cached = currentPriceCache.get(id);
    if (cached && isFresh(cached)) {
      fresh[id] = cached.price;
    } else if (cached) {
      staleEntries[id] = cached.price;
      toFetch.push(id);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) {
    return { prices: fresh, stale: false, updated_at: new Date().toISOString() };
  }

  const now = Date.now();
  const fetched = await fetchPrices(toFetch);
  let anyFailed = false;

  for (const id of toFetch) {
    if (id in fetched) {
      const price = fetched[id];
      fresh[id] = price;
      currentPriceCache.set(id, { price, fetchedAt: now });
    } else if (id in staleEntries) {
      anyFailed = true;
    }
  }

  if (anyFailed) {
    return { prices: { ...fresh, ...staleEntries }, stale: true, updated_at: null };
  }

  return { prices: { ...fresh }, stale: false, updated_at: new Date().toISOString() };
}

export async function getHistoricalPrice(coinId: string, date: string): Promise<number | null> {
  if (!coinId) return null;
  if (isUsdStablecoin(coinId)) return 1;

  const day = date.slice(0, 10);
  const cacheKey = `${coinId}:${day}`;
  const cached = historicalPriceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  interface SpotResponse {
    data?: { amount?: string };
  }

  // Coinbase spot price as of the given calendar day (UTC).
  const data = await safeFetch<SpotResponse>(
    `${BASE_URL}/prices/${encodeURIComponent(toSymbol(coinId))}/spot?date=${day}`,
  );
  const price = data?.data?.amount !== undefined ? parsePrice(data.data.amount) : null;
  if (price !== null) {
    historicalPriceCache.set(cacheKey, price);
  }
  return price;
}

export async function getHistoricalPriceSeries(
  coinId: string,
  startDate: string,
  days: number,
): Promise<Map<string, number>> {
  const series = new Map<string, number>();
  if (!coinId) return series;
  // Stablecoins are priced at 1 inside the engine, so the series fetch is skipped entirely.
  if (isUsdStablecoin(coinId)) return series;

  const start = startDate.slice(0, 10);
  const startTime = Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(startTime)) return series;

  const data = await safeFetch<unknown[]>(
    `${BASE_URL}/klines?symbol=${encodeURIComponent(toSymbol(coinId))}&interval=1d&startTime=${startTime}&limit=${days}`,
  );
  if (!Array.isArray(data)) return series;

  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const openTime = typeof row[0] === "number" ? row[0] : Number(row[0]);
    const price = parsePrice(row[4]);
    if (!Number.isFinite(openTime) || price === null) continue;
    const day = new Date(openTime).toISOString().slice(0, 10);
    series.set(day, price);
    // Back-fill the per-day cache so single-date lookups stay warm (historical prices are immutable).
    historicalPriceCache.set(`${coinId}:${day}`, price);
  }

  return series;
}

export async function getPriceForDate(coinId: string, date: string): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = date.slice(0, 10);

  if (targetDate === today) {
    return getCurrentPrice(coinId);
  }
  return getHistoricalPrice(coinId, targetDate);
}
