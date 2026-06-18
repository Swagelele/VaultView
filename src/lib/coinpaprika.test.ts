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

describe("coinpaprika boundary — getMultiplePrices stale degradation (Risk #5)", () => {
  it("retains stale cached prices and flags stale when a refetch fails", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(() => httpError(429));
    const { getCurrentPrice, getMultiplePrices } = await import("./coinpaprika");

    // 1) prime the cache with a successful fetch
    fetchMock.mockResolvedValueOnce(okJson({ quotes: { USD: { price: 60000 } } }));
    expect(await getCurrentPrice("btc-bitcoin")).toBe(60000);

    // 2) advance past the 120s TTL so the cached entry is stale
    vi.advanceTimersByTime(120_001);

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
