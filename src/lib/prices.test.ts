import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Binance price boundary must degrade to null/[] on every failure mode (rate-limit, network
// error, malformed body, invalid-symbol -1121) — never throw, never fabricate, never emit NaN.
// We stub the module's only external dependency, global `fetch`, so the real parsing/degradation
// logic runs. The price caches are module-global, so we reset modules + re-import per test.

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubFetch(impl: (url: string) => unknown) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

const okJson = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });
const httpError = (status: number) => ({ ok: false, status });

// A Binance daily kline row: [openTime, open, high, low, close, volume, closeTime, ...].
const kline = (iso: string, close: number) => {
  const t = Date.parse(iso);
  return [t, "0", "0", "0", String(close), "0", t + 86_399_999];
};

describe("prices boundary — getCurrentPrice degradation", () => {
  it("returns null on a non-200 response (e.g. 429 rate limit)", async () => {
    stubFetch(() => httpError(429));
    const { getCurrentPrice } = await import("./prices");

    expect(await getCurrentPrice("BTC")).toBeNull();
  });

  it("returns null when fetch throws (network outage)", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    const { getCurrentPrice } = await import("./prices");

    expect(await getCurrentPrice("BTC")).toBeNull();
  });

  it("returns null (not NaN) on a 200 with a malformed body", async () => {
    stubFetch(() => okJson({ unexpected: "shape" }));
    const { getCurrentPrice } = await import("./prices");

    const price = await getCurrentPrice("BTC");
    expect(price).toBeNull();
    expect(Number.isNaN(price as unknown as number)).toBe(false);
  });

  it("returns null on a -1121 invalid-symbol error body (HTTP 200)", async () => {
    stubFetch(() => okJson({ code: -1121, msg: "Invalid symbol." }));
    const { getCurrentPrice } = await import("./prices");

    expect(await getCurrentPrice("NOPE")).toBeNull();
  });

  it("parses the string price on a well-formed 200", async () => {
    stubFetch(() => okJson({ symbol: "BTCUSDT", price: "64000.00" }));
    const { getCurrentPrice } = await import("./prices");

    expect(await getCurrentPrice("BTC")).toBe(64000);
  });

  it("short-circuits stablecoins to 1 without calling fetch", async () => {
    const fetchMock = stubFetch(() => okJson({}));
    const { getCurrentPrice } = await import("./prices");

    expect(await getCurrentPrice("USDT")).toBe(1);
    expect(await getCurrentPrice("USDC")).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("prices boundary — search & historical degradation", () => {
  it("searchCoins returns matches from the static list (no network)", async () => {
    const fetchMock = stubFetch(() => okJson({}));
    const { searchCoins } = await import("./prices");

    const res = await searchCoins("btc");
    expect(res.some((c) => c.id === "BTC")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getHistoricalPrice returns null on an empty klines array", async () => {
    stubFetch(() => okJson([]));
    const { getHistoricalPrice } = await import("./prices");

    expect(await getHistoricalPrice("BTC", "2026-01-01")).toBeNull();
  });

  it("getHistoricalPrice returns the close [4] for a one-candle window", async () => {
    stubFetch(() => okJson([kline("2026-01-01T00:00:00Z", 42000)]));
    const { getHistoricalPrice } = await import("./prices");

    expect(await getHistoricalPrice("BTC", "2026-01-01")).toBe(42000);
  });

  it("getHistoricalPrice short-circuits stablecoins to 1", async () => {
    const fetchMock = stubFetch(() => okJson([]));
    const { getHistoricalPrice } = await import("./prices");

    expect(await getHistoricalPrice("USDT", "2026-01-01")).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("prices boundary — getHistoricalPriceSeries (range fetch)", () => {
  it("parses a daily kline series into a YYYY-MM-DD → close map", async () => {
    stubFetch(() =>
      okJson([
        kline("2026-01-01T00:00:00Z", 40000),
        kline("2026-01-02T00:00:00Z", 41000),
        kline("2026-01-03T00:00:00Z", 42000),
      ]),
    );
    const { getHistoricalPriceSeries } = await import("./prices");

    const series = await getHistoricalPriceSeries("BTC", "2026-01-01", 365);
    expect(series.size).toBe(3);
    expect(series.get("2026-01-01")).toBe(40000);
    expect(series.get("2026-01-03")).toBe(42000);
  });

  it("returns an empty map on fetch failure (caller treats absent dates as 0)", async () => {
    stubFetch(() => httpError(429));
    const { getHistoricalPriceSeries } = await import("./prices");

    const series = await getHistoricalPriceSeries("BTC", "2026-01-01", 365);
    expect(series.size).toBe(0);
  });

  it("skips candles with a non-number close — no NaN entries", async () => {
    const t = Date.parse("2026-01-02T00:00:00Z");
    stubFetch(() => okJson([kline("2026-01-01T00:00:00Z", 40000), [t, "0", "0", "0", "oops", "0", t + 1]]));
    const { getHistoricalPriceSeries } = await import("./prices");

    const series = await getHistoricalPriceSeries("BTC", "2026-01-01", 365);
    expect(series.size).toBe(1);
    expect(series.has("2026-01-02")).toBe(false);
  });

  it("short-circuits stablecoins to an empty series without fetch", async () => {
    const fetchMock = stubFetch(() => okJson([]));
    const { getHistoricalPriceSeries } = await import("./prices");

    const series = await getHistoricalPriceSeries("USDT", "2026-01-01", 365);
    expect(series.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("back-fills the per-day cache: a later getHistoricalPrice for an in-range date hits cache (no new fetch)", async () => {
    const fetchMock = stubFetch(() => okJson([kline("2026-01-01T00:00:00Z", 40000)]));
    const { getHistoricalPriceSeries, getHistoricalPrice } = await import("./prices");

    await getHistoricalPriceSeries("BTC", "2026-01-01", 365);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await getHistoricalPrice("BTC", "2026-01-01")).toBe(40000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("prices boundary — getMultiplePrices", () => {
  it("retains stale cached prices and flags stale when a refetch fails", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(() => httpError(429));
    const { getCurrentPrice, getMultiplePrices, CURRENT_PRICE_TTL_MS } = await import("./prices");

    // 1) prime the cache with a successful fetch
    fetchMock.mockResolvedValueOnce(okJson({ symbol: "BTCUSDT", price: "60000" }));
    expect(await getCurrentPrice("BTC")).toBe(60000);

    // 2) advance past the current-price TTL so the cached entry is stale
    vi.advanceTimersByTime(CURRENT_PRICE_TTL_MS + 1);

    // 3) the refetch now fails (429) → stale price retained, flagged stale, updated_at null
    const result = await getMultiplePrices(["BTC"]);
    expect(result.prices.BTC).toBe(60000);
    expect(result.stale).toBe(true);
    expect(result.updated_at).toBeNull();
  });

  it("omits an uncached asset that fails — no null, no NaN, not flagged stale", async () => {
    stubFetch(() => httpError(500));
    const { getMultiplePrices } = await import("./prices");

    const result = await getMultiplePrices(["DOGE"]);
    expect("DOGE" in result.prices).toBe(false);
    expect(result.stale).toBe(false);
  });

  it("fills stablecoins as 1 without fetching", async () => {
    const fetchMock = stubFetch(() => okJson([]));
    const { getMultiplePrices } = await import("./prices");

    const result = await getMultiplePrices(["USDT", "USDC"]);
    expect(result.prices.USDT).toBe(1);
    expect(result.prices.USDC).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batch-prices multiple symbols from the symbols=[...] response", async () => {
    stubFetch(() =>
      okJson([
        { symbol: "BTCUSDT", price: "60000" },
        { symbol: "ETHUSDT", price: "1500" },
      ]),
    );
    const { getMultiplePrices } = await import("./prices");

    const result = await getMultiplePrices(["BTC", "ETH"]);
    expect(result.prices.BTC).toBe(60000);
    expect(result.prices.ETH).toBe(1500);
    expect(result.stale).toBe(false);
  });
});
