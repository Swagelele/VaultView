/** Format a USD value as `$1,234.56`, or `—` for null (the convention for unknown/unpriced). */
export function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format a crypto quantity, using exponential notation for dust amounts (< 0.0001). */
export function formatQty(value: number): string {
  if (value === 0) return "0";
  if (value < 0.0001) return value.toExponential(4);
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

/** Tailwind text color for a P&L value: green for gains, red for losses, neutral for null/zero. */
export function pnlColor(value: number | null): string {
  if (value === null || value === 0) return "";
  return value > 0 ? "text-green-400" : "text-red-400";
}

/**
 * Derive a display symbol from an asset id. Canonical ids are uppercase Binance tickers (e.g.
 * `BTC`, `USDT`), so the symbol is the id itself; the legacy `{symbol}-{name}` split is retained
 * for safety (ids without a `-` are uppercased as-is). Mirrors the derivation in
 * portfolio-service.ts so the list and portfolio stay consistent.
 */
export function symbolFromId(id: string): string {
  return id.split("-")[0]?.toUpperCase() ?? id.toUpperCase();
}
