/** Format a USD value as `$1,234.56`, or `—` for null (the convention for unknown/unpriced). */
export function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Tailwind text color for a P&L value: green for gains, red for losses, neutral for null/zero. */
export function pnlColor(value: number | null): string {
  if (value === null || value === 0) return "";
  return value > 0 ? "text-green-400" : "text-red-400";
}

/**
 * Derive a display symbol from a CoinPaprika asset id. IDs follow the `{symbol}-{name}` convention
 * (e.g. `btc-bitcoin` → `BTC`, `usdt-tether` → `USDT`); ids without a `-` are uppercased as-is.
 * Mirrors the inline derivation in portfolio-service.ts so the list and portfolio stay consistent.
 */
export function symbolFromId(id: string): string {
  return id.split("-")[0]?.toUpperCase() ?? id.toUpperCase();
}
