import type { CoinSearchResult, PriceLookupResult } from "@/types";

const BASE_URL = "https://api.coinpaprika.com/v1";

export const CURRENT_PRICE_TTL_MS = 120_000;

interface CacheEntry {
  price: number;
  fetchedAt: number;
}

const currentPriceCache = new Map<string, CacheEntry>();
const historicalPriceCache = new Map<string, number>();

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CURRENT_PRICE_TTL_MS;
}

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function searchCoins(query: string): Promise<CoinSearchResult[]> {
  interface SearchCurrency {
    id: string;
    name: string;
    symbol: string;
    rank: number;
    is_active: boolean;
  }

  interface SearchResponse {
    currencies?: SearchCurrency[];
  }

  const data = await safeFetch<SearchResponse>(
    `${BASE_URL}/search?q=${encodeURIComponent(query)}&c=currencies&limit=10`,
  );
  if (!data?.currencies) return [];

  return data.currencies.map((c) => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    rank: c.rank,
    is_active: c.is_active,
  }));
}

export async function getCurrentPrice(coinId: string): Promise<number | null> {
  const cached = currentPriceCache.get(coinId);
  if (cached && isFresh(cached)) return cached.price;

  interface TickerResponse {
    quotes?: { USD?: { price?: number } };
  }

  const data = await safeFetch<TickerResponse>(`${BASE_URL}/tickers/${encodeURIComponent(coinId)}`);
  const price = data?.quotes?.USD?.price ?? null;

  if (price !== null) {
    currentPriceCache.set(coinId, { price, fetchedAt: Date.now() });
  }

  return price;
}

export async function getMultiplePrices(coinIds: string[]): Promise<PriceLookupResult> {
  if (coinIds.length === 0) {
    return { prices: {}, stale: false, updated_at: null };
  }

  const fresh: Record<string, number> = {};
  const staleEntries: Record<string, number> = {};
  const toFetch: string[] = [];

  for (const id of coinIds) {
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
    return {
      prices: fresh,
      stale: false,
      updated_at: new Date().toISOString(),
    };
  }

  const now = Date.now();
  const results = await Promise.all(toFetch.map((id) => getCurrentPrice(id).then((p) => ({ id, price: p }))));
  let anyFailed = false;

  for (const { id, price } of results) {
    if (price !== null) {
      fresh[id] = price;
      currentPriceCache.set(id, { price, fetchedAt: now });
    } else if (id in staleEntries) {
      anyFailed = true;
    }
  }

  if (anyFailed) {
    return {
      prices: { ...fresh, ...staleEntries },
      stale: true,
      updated_at: null,
    };
  }

  return {
    prices: { ...fresh },
    stale: false,
    updated_at: new Date().toISOString(),
  };
}

export async function getHistoricalPrice(coinId: string, date: string): Promise<number | null> {
  const cacheKey = `${coinId}:${date}`;
  const cached = historicalPriceCache.get(cacheKey);
  if (cached !== undefined) return cached;

  interface HistoricalTick {
    timestamp?: string;
    price?: number;
  }

  const data = await safeFetch<HistoricalTick[]>(
    `${BASE_URL}/tickers/${encodeURIComponent(coinId)}/historical?start=${encodeURIComponent(date)}&interval=1d&limit=1`,
  );

  const price = data?.[0]?.price ?? null;
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
  interface HistoricalTick {
    timestamp?: string;
    price?: number;
  }

  const start = startDate.slice(0, 10);
  const data = await safeFetch<HistoricalTick[]>(
    `${BASE_URL}/tickers/${encodeURIComponent(coinId)}/historical?start=${encodeURIComponent(start)}&interval=1d&limit=${days}`,
  );

  const series = new Map<string, number>();
  if (!data) return series;

  for (const tick of data) {
    const date = tick.timestamp?.slice(0, 10);
    const price = tick.price;
    if (!date || typeof price !== "number") continue;
    series.set(date, price);
    // Back-fill the per-day cache so single-date lookups stay warm (historical prices are immutable).
    historicalPriceCache.set(`${coinId}:${date}`, price);
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
