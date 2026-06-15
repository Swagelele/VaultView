import type { CoinSearchResult, PriceLookupResult } from "@/types";

const BASE_URL = "https://api.coinpaprika.com/v1";

const CURRENT_PRICE_TTL_MS = 120_000;

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

  interface TickerItem {
    id: string;
    quotes?: { USD?: { price?: number } };
  }

  const data = await safeFetch<TickerItem[]>(`${BASE_URL}/tickers`);
  const now = Date.now();

  if (data) {
    const tickerMap = new Map<string, number>();
    for (const item of data) {
      const price = item.quotes?.USD?.price;
      if (price !== undefined) {
        tickerMap.set(item.id, price);
      }
    }

    for (const id of toFetch) {
      const price = tickerMap.get(id);
      if (price !== undefined) {
        fresh[id] = price;
        currentPriceCache.set(id, { price, fetchedAt: now });
      }
    }

    return {
      prices: { ...fresh },
      stale: false,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    prices: { ...fresh, ...staleEntries },
    stale: Object.keys(staleEntries).length > 0,
    updated_at: null,
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

export async function getPriceForDate(coinId: string, date: string): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = date.slice(0, 10);

  if (targetDate === today) {
    return getCurrentPrice(coinId);
  }

  return getHistoricalPrice(coinId, targetDate);
}
