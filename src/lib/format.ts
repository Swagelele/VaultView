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
