import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolvePriceUsd } from "./transaction-service";
import { getPriceForDate } from "@/lib/coinpaprika";

// CoinPaprika is mocked — no network in unit tests. getMultiplePrices is unused here but must be
// present so the module's other exports import cleanly.
vi.mock("@/lib/coinpaprika", () => ({
  getPriceForDate: vi.fn(),
  getMultiplePrices: vi.fn(),
}));

const mockedGetPriceForDate = vi.mocked(getPriceForDate);

describe("resolvePriceUsd — DEPOSIT cost basis (S-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("override wins over everything, even for a non-stablecoin deposit", async () => {
    const price = await resolvePriceUsd("DEPOSIT", "btc-bitcoin", null, null, 1, "2024-01-01T00:00:00Z", 50000);

    expect(price).toBe(50000);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("stablecoin deposit returns $1 without an API call", async () => {
    const price = await resolvePriceUsd("DEPOSIT", "usdt-tether", null, null, 100, "2026-03-01T00:00:00Z");

    expect(price).toBe(1);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("non-stablecoin deposit derives cost basis from the historical price at the purchase date", async () => {
    mockedGetPriceForDate.mockResolvedValue(42000);

    const price = await resolvePriceUsd("DEPOSIT", "btc-bitcoin", null, null, 1, "2026-03-01T12:30:00Z");

    expect(price).toBe(42000);
    expect(mockedGetPriceForDate).toHaveBeenCalledWith("btc-bitcoin", "2026-03-01");
  });

  it("returns null when no historical price is available (caller surfaces a 400)", async () => {
    mockedGetPriceForDate.mockResolvedValue(null);

    const price = await resolvePriceUsd("DEPOSIT", "btc-bitcoin", null, null, 1, "2020-01-01T00:00:00Z");

    expect(price).toBeNull();
  });
});

describe("resolvePriceUsd — WITHDRAW realized price (S-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("override wins over everything, even for a non-stablecoin withdraw", async () => {
    const price = await resolvePriceUsd("WITHDRAW", "btc-bitcoin", null, null, 1, "2026-06-17T00:00:00Z", 70000);

    expect(price).toBe(70000);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("stablecoin withdraw returns $1 without an API call (realized P&L ≈ 0)", async () => {
    const price = await resolvePriceUsd("WITHDRAW", "usdt-tether", null, null, 100, "2026-06-17T00:00:00Z");

    expect(price).toBe(1);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("non-stablecoin withdraw resolves the current market price via getPriceForDate", async () => {
    mockedGetPriceForDate.mockResolvedValue(70000);

    const price = await resolvePriceUsd("WITHDRAW", "btc-bitcoin", null, null, 1, "2026-06-17T12:30:00Z");

    expect(price).toBe(70000);
    expect(mockedGetPriceForDate).toHaveBeenCalledWith("btc-bitcoin", "2026-06-17");
  });

  it("returns null when no price is available (caller surfaces a 400)", async () => {
    mockedGetPriceForDate.mockResolvedValue(null);

    const price = await resolvePriceUsd("WITHDRAW", "btc-bitcoin", null, null, 1, "2026-06-17T00:00:00Z");

    expect(price).toBeNull();
  });
});
