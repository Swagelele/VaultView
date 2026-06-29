import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Coinbase price boundary must degrade to null/[] on every failure mode (rate-limit, network
// error, malformed body, unknown product) — never throw, never fabricate, never emit NaN.
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

// A Coinbase daily candle row: [time(seconds), low, high, open, close, volume].
const candle = (iso: string, close: number | string) => [Math.floor(Date.parse(iso) / 1000), 0, 0, 0, close, 0];

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

  it("returns null on an unknown product (non-200)", async () => {
    stubFetch(() => httpError(404));
    const { getCurrentPrice } = await import("./prices");

    expect(await getCurrentPrice("NOPE")).toBeNull();
  });

  it("parses the string amount on a well-formed 200", async () => {
    stubFetch(() => okJson({ data: { amount: "64000.00" } }));
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

  it("getHistoricalPrice returns null on a miss (absent data.amount)", async () => {
    stubFetch(() => okJson({}));
    const { getHistoricalPrice } = await import("./prices");

    expect(await getHistoricalPrice("BTC", "2026-01-01")).toBeNull();
  });

  it("getHistoricalPrice returns the amount from the dated spot response", async () => {
    stubFetch(() => okJson({ data: { amount: "42000" } }));
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
  it("parses a daily candle series into a YYYY-MM-DD → close map", async () => {
    stubFetch(() =>
      okJson([
        candle("2026-01-01T00:00:00Z", 40000),
        candle("2026-01-02T00:00:00Z", 41000),
        candle("2026-01-03T00:00:00Z", 42000),
      ]),
    );
    const { getHistoricalPriceSeries } = await import("./prices");

    const series = await getHistoricalPriceSeries("BTC", "2026-01-01", 3);
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
    stubFetch(() => okJson([candle("2026-01-01T00:00:00Z", 40000), candle("2026-01-02T00:00:00Z", "oops")]));
    const { getHistoricalPriceSeries } = await import("./prices");

    const series = await getHistoricalPriceSeries("BTC", "2026-01-01", 3);
    expect(series.size).toBe(1);
    expect(series.has("2026-01-02")).toBe(false);
  });

  it("chunks a >300-day window into multiple candle requests and merges them", async () => {
    const fetchMock = stubFetch((url) => {
      const m = /start=([^&]+)/.exec(url);
      const day = m ? decodeURIComponent(m[1]).slice(0, 10) : "1970-01-01";
      return okJson([candle(`${day}T00:00:00Z`, 50000)]);
    });
    const { getHistoricalPriceSeries } = await import("./prices");

    const series = await getHistoricalPriceSeries("BTC", "2025-01-01", 365);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 365 days → 300 + 65
    expect(series.size).toBe(2);
    expect(series.has("2025-01-01")).toBe(true); // first chunk start
  });

  it("short-circuits stablecoins to an empty series without fetch", async () => {
    const fetchMock = stubFetch(() => okJson([]));
    const { getHistoricalPriceSeries } = await import("./prices");

    const series = await getHistoricalPriceSeries("USDT", "2026-01-01", 365);
    expect(series.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("back-fills the per-day cache: a later getHistoricalPrice for an in-range date hits cache (no new fetch)", async () => {
    const fetchMock = stubFetch(() => okJson([candle("2026-01-01T00:00:00Z", 40000)]));
    const { getHistoricalPriceSeries, getHistoricalPrice } = await import("./prices");

    await getHistoricalPriceSeries("BTC", "2026-01-01", 30);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await getHistoricalPrice("BTC", "2026-01-01")).toBe(40000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("prices boundary — getHistoricalPrice deep-history fallback", () => {
  it("falls back to a daily candle when spot?date misses (old date beyond the ~2yr window)", async () => {
    stubFetch((url) => {
      if (url.includes("/spot?date=")) return httpError(404);
      if (url.includes("/candles")) return okJson([candle("2023-01-01T00:00:00Z", 16500)]);
      return httpError(404);
    });
    const { getHistoricalPrice } = await import("./prices");

    expect(await getHistoricalPrice("BTC", "2023-01-01")).toBe(16500);
  });
});

describe("prices boundary — getMultiplePrices", () => {
  it("retains stale cached prices and flags stale when a refetch fails", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(() => httpError(429));
    const { getCurrentPrice, getMultiplePrices, CURRENT_PRICE_TTL_MS } = await import("./prices");

    // 1) prime the cache with a successful fetch
    fetchMock.mockResolvedValueOnce(okJson({ data: { amount: "60000" } }));
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

  it("prices multiple symbols via parallel per-symbol /spot calls", async () => {
    stubFetch((url) => {
      if (url.includes("BTC-USD")) return okJson({ data: { amount: "60000" } });
      if (url.includes("ETH-USD")) return okJson({ data: { amount: "1500" } });
      return httpError(404);
    });
    const { getMultiplePrices } = await import("./prices");

    const result = await getMultiplePrices(["BTC", "ETH"]);
    expect(result.prices.BTC).toBe(60000);
    expect(result.prices.ETH).toBe(1500);
    expect(result.stale).toBe(false);
  });
});
