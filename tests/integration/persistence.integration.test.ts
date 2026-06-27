import { describe, it, expect, afterEach } from "vitest";
import { createTransaction, createSellAllGlobal } from "@/lib/transaction-service";
import { serviceClient } from "./clients";
import { createTestUser, deleteTestUser, type TestUser } from "./users";
import { seedTransaction, selectTransactions, countTransactions } from "./transactions";
import { dbAvailable } from "./db";

// Risk #3 — a save reports success but persists wrong/partial state. Every assertion reads the
// PERSISTED row back via an independent service-role SELECT (not the function's return value), and
// the failure cases prove zero rows land. Inputs use a stablecoin side or `source_price_usd_override`
// so the CoinPaprika price path never runs — the exact price_usd/price values asserted below are the
// proof of that (a live API price would not equal the override/derived figure).
const svc = serviceClient();
const createdUserIds: string[] = [];

async function newUser(): Promise<TestUser> {
  const user = await createTestUser(svc, createdUserIds.length);
  createdUserIds.push(user.id);
  return user;
}

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    if (id) {
      await deleteTestUser(svc, id);
    }
  }
});

describe.skipIf(!dbAvailable)("persistence (Risk #3)", () => {
  it("DEPOSIT persists a one-sided row: target columns NULL, price === price_usd === override", async () => {
    const user = await newUser();

    const result = await createTransaction(svc, user.id, {
      type: "DEPOSIT",
      source_asset: "BTC",
      source_quantity: 2,
      source_price_usd_override: 50000,
      location: "ColdWallet",
      transaction_date: "2026-01-01T00:00:00Z",
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();

    const rows = await selectTransactions(svc, { userId: user.id });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.type).toBe("DEPOSIT");
    expect(row.source_asset).toBe("BTC");
    expect(row.source_quantity).toBe(2);
    // one-sided op: no target arm, and the `price` column carries the USD valuation directly
    // (transaction-service.ts:135-149).
    expect(row.target_asset).toBeNull();
    expect(row.target_quantity).toBeNull();
    expect(row.price).toBe(50000);
    expect(row.price_usd).toBe(50000);
    expect(row.location).toBe("ColdWallet");
    expect(new Date(row.transaction_date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("SELL to a stablecoin persists the derived rate as both price and price_usd", async () => {
    const user = await newUser();
    // Seed 2 BTC at Binance so the SELL's holding pre-check passes (transaction-service.ts:105-113).
    await seedTransaction(svc, {
      user_id: user.id,
      type: "DEPOSIT",
      source_asset: "BTC",
      source_quantity: 2,
      target_asset: null,
      target_quantity: null,
      price: 50000,
      price_usd: 50000,
      fee: 0,
      location: "Binance",
      transaction_date: "2026-01-02T00:00:00Z",
    });

    // Sell 1 BTC for 60000 USDT. Stablecoin target → price_usd = target_qty / source_qty = 60000 / 1 = 60000.
    const result = await createTransaction(svc, user.id, {
      type: "SELL",
      source_asset: "BTC",
      source_quantity: 1,
      target_asset: "USDT",
      target_quantity: 60000,
      location: "Binance",
      transaction_date: "2026-01-03T00:00:00Z",
    });
    expect(result.error).toBeUndefined();

    const sells = (await selectTransactions(svc, { userId: user.id })).filter((r) => r.type === "SELL");
    expect(sells).toHaveLength(1);
    const row = sells[0];
    expect(row.target_asset).toBe("USDT");
    expect(row.target_quantity).toBe(60000);
    expect(row.source_quantity).toBe(1);
    expect(row.price).toBe(60000); // rate = target_qty / source_qty = 60000 / 1
    expect(row.price_usd).toBe(60000); // stablecoin target → USD price per BTC
  });

  it("a save that fails the holding check returns 409 and persists nothing", async () => {
    const user = await newUser();
    // No holding of BTC anywhere → the holding pre-check rejects before any insert.
    const result = await createTransaction(svc, user.id, {
      type: "SELL",
      source_asset: "BTC",
      source_quantity: 1,
      target_asset: "USDT",
      target_quantity: 60000,
      location: "Binance",
      transaction_date: "2026-01-04T00:00:00Z",
    });
    expect(result.status).toBe(409);
    expect(result.data).toBeUndefined();
    expect(await countTransactions(svc, { userId: user.id })).toBe(0);
  });

  it("sell-all-global rejects the whole batch when any location has no holding (0 SELL rows persisted)", async () => {
    const user = await newUser();
    // Holding only at Binance; "Empty" has none.
    await seedTransaction(svc, {
      user_id: user.id,
      type: "DEPOSIT",
      source_asset: "BTC",
      source_quantity: 2,
      target_asset: null,
      target_quantity: null,
      price: 50000,
      price_usd: 50000,
      fee: 0,
      location: "Binance",
      transaction_date: "2026-01-05T00:00:00Z",
    });

    const result = await createSellAllGlobal(svc, user.id, {
      source_asset: "BTC",
      price: 50000,
      transaction_date: "2026-01-06T00:00:00Z",
      locations: [
        { location: "Binance", target_asset: "USDT", fee: 0 },
        { location: "Empty", target_asset: "USDT", fee: 0 },
      ],
    });
    expect(result.status).toBe(409);

    // All-or-nothing: no SELL rows inserted — only the seed DEPOSIT remains.
    const sells = (await selectTransactions(svc, { userId: user.id })).filter((r) => r.type === "SELL");
    expect(sells).toHaveLength(0);
  });

  it("sell-all-global persists exactly one SELL per location with target_quantity = holding × price", async () => {
    const user = await newUser();
    const price = 50000;
    for (const [location, qty] of [
      ["Binance", 2],
      ["Metamask", 3],
    ] as const) {
      await seedTransaction(svc, {
        user_id: user.id,
        type: "DEPOSIT",
        source_asset: "BTC",
        source_quantity: qty,
        target_asset: null,
        target_quantity: null,
        price,
        price_usd: price,
        fee: 0,
        location,
        transaction_date: "2026-01-07T00:00:00Z",
      });
    }

    const result = await createSellAllGlobal(svc, user.id, {
      source_asset: "BTC",
      price,
      transaction_date: "2026-01-08T00:00:00Z",
      locations: [
        { location: "Binance", target_asset: "USDT", fee: 0 },
        { location: "Metamask", target_asset: "USDT", fee: 0 },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);

    const sells = (await selectTransactions(svc, { userId: user.id })).filter((r) => r.type === "SELL");
    expect(sells).toHaveLength(2);
    const byLocation = new Map(sells.map((r) => [r.location, r] as const));
    // target_quantity = holding × price
    expect(byLocation.get("Binance")?.target_quantity).toBe(2 * price); // 100000
    expect(byLocation.get("Metamask")?.target_quantity).toBe(3 * price); // 150000
    expect(byLocation.get("Binance")?.price_usd).toBe(price);
    expect(byLocation.get("Metamask")?.price_usd).toBe(price);
  });
});
