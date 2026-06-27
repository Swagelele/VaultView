import { describe, it, expect } from "vitest";
import { ASSET_TICKERS, searchAssetList } from "./asset-list";

describe("asset-list", () => {
  it("is non-empty and contains the majors", () => {
    expect(ASSET_TICKERS.length).toBeGreaterThan(100);
    for (const major of ["BTC", "ETH", "USDT", "USDC", "SOL"]) {
      expect(ASSET_TICKERS).toContain(major);
    }
  });

  it("holds only clean uppercase alphanumeric tickers", () => {
    for (const ticker of ASSET_TICKERS) {
      expect(ticker).toMatch(/^[A-Z0-9]+$/);
    }
  });

  it("searches case-insensitively by substring and caps the result count", () => {
    const btc = searchAssetList("btc");
    expect(btc.some((c) => c.id === "BTC")).toBe(true);
    expect(btc.every((c) => c.is_active)).toBe(true);
    expect(searchAssetList("b", 5).length).toBeLessThanOrEqual(5);
  });

  it("returns the CoinSearchResult shape with id === symbol (ticker-only labels)", () => {
    const [first] = searchAssetList("eth");
    expect(first).toMatchObject({ id: "ETH", symbol: "ETH", name: "ETH", rank: 0, is_active: true });
  });

  it("returns nothing for an empty query", () => {
    expect(searchAssetList("")).toEqual([]);
  });
});
