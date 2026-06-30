import { z } from "zod";

// Canonical asset ids are uppercase Coinbase tickers. Components compare against this constant
// directly (e.g. `USD_STABLECOINS.includes(rawId)`), so it must hold the uppercase ids. This is the
// single source of truth for USD-pegged assets — the price adapter (`prices.ts`) imports
// `isUsdStablecoin` rather than keeping its own list.
export const USD_STABLECOINS = ["USDT", "USDC"];

export function isUsdStablecoin(coinId: string): boolean {
  return USD_STABLECOINS.includes(coinId.toUpperCase());
}

const baseSchema = z.object({
  type: z.enum(["DEPOSIT", "BUY", "SELL", "SWAP", "WITHDRAW"]),
  source_asset: z.string().min(1, "Source asset is required"),
  source_quantity: z.number().positive("Source quantity must be positive"),
  target_asset: z.string().min(1).nullable().optional(),
  target_quantity: z.number().positive().nullable().optional(),
  price: z.number().positive().optional(),
  source_price_usd_override: z.number().positive().optional(),
  fee: z.number().min(0, "Fee cannot be negative").optional().default(0),
  location: z.string().min(1, "Location is required"),
  transaction_date: z.string().min(1, "Transaction date is required"),
});

export const createTransactionSchema = baseSchema.superRefine((data, ctx) => {
  // DEPOSIT and WITHDRAW are one-sided ops — no target side. (S-06: WITHDRAW is a cash-out that
  // realizes P&L on the source against average cost; it shares DEPOSIT's shape but SELL's accounting.)
  if (data.type === "DEPOSIT" || data.type === "WITHDRAW") {
    // S-05: DEPOSIT accepts any asset; cost basis is derived from the historical price at the
    // purchase date (or a manual override). A purchase can't have happened in the future.
    // (WITHDRAW prices at current market, so the future-date guard stays DEPOSIT-only.)
    if (data.type === "DEPOSIT" && new Date(data.transaction_date).getTime() > Date.now()) {
      ctx.addIssue({
        code: "custom",
        message: "Deposit date cannot be in the future",
        path: ["transaction_date"],
      });
    }
    if (data.target_asset) {
      ctx.addIssue({
        code: "custom",
        message: `${data.type} must not have a target asset`,
        path: ["target_asset"],
      });
    }
    if (data.target_quantity) {
      ctx.addIssue({
        code: "custom",
        message: `${data.type} must not have a target quantity`,
        path: ["target_quantity"],
      });
    }
  } else {
    if (!data.target_asset) {
      ctx.addIssue({
        code: "custom",
        message: `${data.type} requires a target asset`,
        path: ["target_asset"],
      });
    }
    if (!data.target_quantity || data.target_quantity <= 0) {
      ctx.addIssue({
        code: "custom",
        message: `${data.type} requires a positive target quantity`,
        path: ["target_quantity"],
      });
    }
  }
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

const sellAllLocationSchema = z.object({
  location: z.string().min(1, "Location is required"),
  target_asset: z.string().min(1, "Target asset is required"),
  fee: z.number().min(0, "Fee cannot be negative").optional().default(0),
});

export const createSellAllGlobalSchema = z
  .object({
    source_asset: z.string().min(1, "Source asset is required"),
    price: z.number().positive("Price must be positive"),
    transaction_date: z.string().min(1, "Transaction date is required"),
    locations: z.array(sellAllLocationSchema).min(1, "At least one location is required"),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.locations.forEach((row, i) => {
      if (seen.has(row.location)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate location: ${row.location}`,
          path: ["locations", i, "location"],
        });
      }
      seen.add(row.location);

      // S-08 scope: sell-all targets are restricted to USD stablecoins so the
      // non-stablecoin target_quantity quirk (wrong P&L) can never be triggered.
      if (!isUsdStablecoin(row.target_asset)) {
        ctx.addIssue({
          code: "custom",
          message: `Sell-all target must be a USD stablecoin (USDT, USDC); got ${row.target_asset}`,
          path: ["locations", i, "target_asset"],
        });
      }
    });
  });

export type CreateSellAllGlobalInput = z.infer<typeof createSellAllGlobalSchema>;
