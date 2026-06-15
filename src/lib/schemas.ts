import { z } from "zod";

const USD_STABLECOINS = ["usdt-tether", "usdc-usd-coin"];

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
