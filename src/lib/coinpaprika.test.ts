import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Risk #5: the CoinPaprika boundary must degrade to null/[] on every failure mode (rate-limit,
// network error, malformed body) — never throw, never fabricate, never emit NaN. We stub the
// module's only external dependency, global `fetch`, so the real parsing/degradation logic runs.
// The price caches are module-global, so we reset modules + re-import per test to avoid bleed.

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

describe("coinpaprika boundary — getCurrentPrice degradation (Risk #5)", () => {
  it("returns null on a non-200 response (e.g. 429 rate limit)", async () => {
    stubFetch(() => httpError(429));
    const { getCurrentPrice } = await import("./coinpaprika");

    expect(await getCurrentPrice("btc-bitcoin")).toBeNull();
  });

  it("returns null when fetch throws (network outage)", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    const { getCurrentPrice } = await import("./coinpaprika");

    expect(await getCurrentPrice("btc-bitcoin")).toBeNull();
  });

  it("returns null (not NaN) on a 200 with a malformed body", async () => {
    stubFetch(() => okJson({ unexpected: "shape" }));
    const { getCurrentPrice } = await import("./coinpaprika");

    const price = await getCurrentPrice("btc-bitcoin");
    expect(price).toBeNull();
    expect(Number.isNaN(price as unknown as number)).toBe(false);
  });

  it("returns the USD price on a well-formed 200", async () => {
    stubFetch(() => okJson({ quotes: { USD: { price: 64000 } } }));
    const { getCurrentPrice } = await import("./coinpaprika");

    expect(await getCurrentPrice("btc-bitcoin")).toBe(64000);
  });
});

describe("coinpaprika boundary — search & historical degradation (Risk #5)", () => {
  it("searchCoins returns [] when the body lacks currencies", async () => {
    stubFetch(() => okJson({}));
    const { searchCoins } = await import("./coinpaprika");

    expect(await searchCoins("btc")).toEqual([]);
  });

  it("getHistoricalPrice returns null on an empty result array", async () => {
    stubFetch(() => okJson([]));
    const { getHistoricalPrice } = await import("./coinpaprika");

    expect(await getHistoricalPrice("btc-bitcoin", "2026-01-01")).toBeNull();
  });
});

describe("coinpaprika boundary — getHistoricalPriceSeries (range fetch)", () => {
  const tick = (timestamp: string, price: number) => ({ timestamp, price });

  it("parses a daily series into a YYYY-MM-DD → price map", async () => {
    stubFetch(() =>
      okJson([
        tick("2026-01-01T00:00:00Z", 40000),
        tick("2026-01-02T00:00:00Z", 41000),
        tick("2026-01-03T00:00:00Z", 42000),
      ]),
    );
    const { getHistoricalPriceSeries } = await import("./coinpaprika");

    const series = await getHistoricalPriceSeries("btc-bitcoin", "2026-01-01", 365);
    expect(series.size).toBe(3);
    expect(series.get("2026-01-01")).toBe(40000);
    expect(series.get("2026-01-03")).toBe(42000);
  });

  it("returns an empty map on fetch failure (caller treats absent dates as 0)", async () => {
    stubFetch(() => httpError(429));
    const { getHistoricalPriceSeries } = await import("./coinpaprika");

    const series = await getHistoricalPriceSeries("btc-bitcoin", "2026-01-01", 365);
    expect(series.size).toBe(0);
  });

  it("skips ticks with a non-number price — no NaN entries", async () => {
    stubFetch(() =>
      okJson([tick("2026-01-01T00:00:00Z", 40000), { timestamp: "2026-01-02T00:00:00Z", price: "oops" }]),
    );
    const { getHistoricalPriceSeries } = await import("./coinpaprika");

    const series = await getHistoricalPriceSeries("btc-bitcoin", "2026-01-01", 365);
    expect(series.size).toBe(1);
    expect(series.has("2026-01-02")).toBe(false);
  });

  it("back-fills the per-day cache: a later getHistoricalPrice for an in-range date hits cache (no new fetch)", async () => {
    const fetchMock = stubFetch(() => okJson([tick("2026-01-01T00:00:00Z", 40000)]));
    const { getHistoricalPriceSeries, getHistoricalPrice } = await import("./coinpaprika");

    await getHistoricalPriceSeries("btc-bitcoin", "2026-01-01", 365);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The cached date resolves without issuing a second request.
    expect(await getHistoricalPrice("btc-bitcoin", "2026-01-01")).toBe(40000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("coinpaprika boundary — getMultiplePrices stale degradation (Risk #5)", () => {
  it("retains stale cached prices and flags stale when a refetch fails", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(() => httpError(429));
    const { getCurrentPrice, getMultiplePrices, CURRENT_PRICE_TTL_MS } = await import("./coinpaprika");

    // 1) prime the cache with a successful fetch
    fetchMock.mockResolvedValueOnce(okJson({ quotes: { USD: { price: 60000 } } }));
    expect(await getCurrentPrice("btc-bitcoin")).toBe(60000);

    // 2) advance past the current-price TTL so the cached entry is stale (derive from the
    //    source constant so this boundary stays correct if the TTL ever changes)
    vi.advanceTimersByTime(CURRENT_PRICE_TTL_MS + 1);

    // 3) the refetch now fails (429) → stale price retained, flagged stale, updated_at null
    const result = await getMultiplePrices(["btc-bitcoin"]);
    expect(result.prices["btc-bitcoin"]).toBe(60000);
    expect(result.stale).toBe(true);
    expect(result.updated_at).toBeNull();
  });

  it("omits an uncached asset that fails — no null, no NaN, not flagged stale", async () => {
    stubFetch(() => httpError(500));
    const { getMultiplePrices } = await import("./coinpaprika");

    const result = await getMultiplePrices(["doge-dogecoin"]);
    expect("doge-dogecoin" in result.prices).toBe(false);
    expect(result.stale).toBe(false);
  });
});
