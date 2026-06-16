import { z } from "zod";

export const USD_STABLECOINS = ["usdt-tether", "usdc-usd-coin"];

export function isUsdStablecoin(coinId: string): boolean {
  return USD_STABLECOINS.includes(coinId.toLowerCase());
}

const baseSchema = z.object({
  type: z.enum(["DEPOSIT", "BUY", "SELL", "SWAP"]),
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
  if (data.type === "DEPOSIT") {
    if (!isUsdStablecoin(data.source_asset)) {
      ctx.addIssue({
        code: "custom",
        message: "S-01 DEPOSIT is limited to USD stablecoins (usdt-tether, usdc-usd-coin). Use S-05 for other assets.",
        path: ["source_asset"],
      });
    }
    if (data.target_asset) {
      ctx.addIssue({
        code: "custom",
        message: "DEPOSIT must not have a target asset",
        path: ["target_asset"],
      });
    }
    if (data.target_quantity) {
      ctx.addIssue({
        code: "custom",
        message: "DEPOSIT must not have a target quantity",
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
          message: `Sell-all target must be a USD stablecoin (usdt-tether, usdc-usd-coin); got ${row.target_asset}`,
          path: ["locations", i, "target_asset"],
        });
      }
    });
  });

export type CreateSellAllGlobalInput = z.infer<typeof createSellAllGlobalSchema>;
