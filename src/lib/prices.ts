import type { CoinSearchResult, PriceLookupResult } from "@/types";
import { searchAssetList } from "@/lib/asset-list";

// Binance public market-data host. Read-only, no API key, per-minute weight budget (resilient to
// shared-IP contention, unlike a monthly cap). `api.binance.com` is firewall-blocked in some
// networks; this `.vision` data host is not. Canonical asset ids are uppercase tickers (BTC),
// mapped to a Binance spot symbol as `${id}USDT`.
const BASE_URL = "https://data-api.binance.vision/api/v3";

// Abort a hung upstream socket rather than hanging the request (closes a documented boundary gap).
const FETCH_TIMEOUT_MS = 8_000;

export const CURRENT_PRICE_TTL_MS = 120_000;

// Stablecoins are priced at a constant $1: there is no `USDTUSDT` pair, and pinning USDC to $1 too
// keeps it consistent with the P&L engine (which treats both as exactly $1) rather than showing a
// market 1.001 in one view and 1.00 in another. Mirror of `schemas.USD_STABLECOINS` in ticker form.
const USD_PEGGED = new Set(["USDT", "USDC"]);

function isPegged(id: string): boolean {
  return USD_PEGGED.has(id.toUpperCase());
}

function toSymbol(id: string): string {
  return `${id.toUpperCase()}USDT`;
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

/** Fetch + parse JSON, degrading every failure (non-200, network throw, timeout) to null. */
async function safeFetch<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
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
  if (isPegged(coinId)) return 1;

  const cached = currentPriceCache.get(coinId);
  if (cached && isFresh(cached)) return cached.price;

  interface TickerResponse {
    symbol?: string;
    price?: string;
  }

  const data = await safeFetch<TickerResponse>(
    `${BASE_URL}/ticker/price?symbol=${encodeURIComponent(toSymbol(coinId))}`,
  );
  // An invalid symbol returns `{code:-1121,msg}` (HTTP 200) — `price` is absent → null.
  const price = data?.price !== undefined ? parsePrice(data.price) : null;
  if (price !== null) {
    currentPriceCache.set(coinId, { price, fetchedAt: Date.now() });
  }
  return price;
}

/** Batch-fetch the given ids' USD prices. Falls back to per-symbol fetches if the batch fails so a
 *  single bad/delisted ticker can't blank every price (Binance fails the whole batch on one bad symbol). */
async function fetchPrices(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (ids.length === 0) return out;

  const symbolToId = new Map(ids.map((id) => [toSymbol(id), id]));
  const symbolsParam = JSON.stringify([...symbolToId.keys()]);
  const data = await safeFetch<unknown>(`${BASE_URL}/ticker/price?symbols=${encodeURIComponent(symbolsParam)}`);

  if (Array.isArray(data)) {
    for (const entry of data) {
      const ticker = entry as { symbol?: string; price?: unknown };
      const id = ticker.symbol ? symbolToId.get(ticker.symbol) : undefined;
      const price = parsePrice(ticker.price);
      if (id !== undefined && price !== null) out[id] = price;
    }
    return out;
  }

  // Batch failed (network error, or one invalid symbol → whole-batch -1121). Isolate per symbol.
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
    if (isPegged(id)) {
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
  if (isPegged(coinId)) return 1;

  const day = date.slice(0, 10);
  const cacheKey = `${coinId}:${day}`;
  const cached = historicalPriceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const startTime = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(startTime)) return null;
  const endTime = startTime + 86_399_999;

  // One daily candle for the target day; close is index [4].
  const data = await safeFetch<unknown[]>(
    `${BASE_URL}/klines?symbol=${encodeURIComponent(toSymbol(coinId))}&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=1`,
  );
  if (!Array.isArray(data) || data.length === 0) return null;

  const row = data[0];
  const price = Array.isArray(row) ? parsePrice(row[4]) : null;
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
  // Stablecoins are priced at 1 inside the engine, so the series fetch is skipped entirely.
  if (isPegged(coinId)) return series;

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
