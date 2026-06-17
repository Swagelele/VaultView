import { Card, CardContent } from "@/components/ui/card";
import { formatUsd } from "@/lib/format";
import { computeAllocation } from "@/lib/asset-allocation";
import { allocationColor } from "@/lib/chart-colors";
import type { PortfolioAsset } from "@/types";

// A circle with this radius has a circumference of exactly 100, so each slice's stroke-dasharray
// is just its percentage and stroke-dashoffset is a running percentage — no pathLength juggling.
const RADIUS = 15.915494309189533;
const STROKE_WIDTH = 6;
const CENTER = 21;
// Offset that rotates the dash start from 3 o'clock to 12 o'clock (a quarter of the circumference).
const TOP_OFFSET = 25;

interface AssetAllocationChartProps {
  assets: PortfolioAsset[];
}

export function AssetAllocationChart({ assets }: AssetAllocationChartProps) {
  const { slices, totalValue, excludedCount } = computeAllocation(assets);

  const excludedNote =
    excludedCount > 0 ? (
      <p className="text-muted-foreground mt-3 text-xs">
        {excludedCount} asset{excludedCount === 1 ? "" : "s"} excluded (no current price).
      </p>
    ) : null;

  if (slices.length === 0) {
    return (
      <Card>
        <CardContent>
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Allocation</span>
          <p className="text-muted-foreground py-8 text-center text-sm">No priced holdings to chart yet.</p>
          {excludedNote}
        </CardContent>
      </Card>
    );
  }

  // Precompute each slice's percentage and dash offset (where it starts around the ring) so the
  // render body stays free of mutable accumulators (react-compiler forbids in-render reassignment).
  const arcs = slices.map((slice, i) => {
    const pct = slice.fraction * 100;
    const precedingPct = slices.slice(0, i).reduce((sum, s) => sum + s.fraction * 100, 0);
    return { slice, color: allocationColor(i), pct, dashOffset: TOP_OFFSET - precedingPct };
  });

  return (
    <Card>
      <CardContent>
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Allocation</span>
        <div className="mt-2 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          <div className="relative h-44 w-44 shrink-0">
            <svg viewBox="0 0 42 42" className="h-full w-full" role="img" aria-label="Asset allocation by value">
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="transparent"
                stroke="currentColor"
                strokeWidth={STROKE_WIDTH}
                className="text-white/5"
              />
              {arcs.map(({ slice, color, pct, dashOffset }) => (
                <circle
                  key={slice.asset}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="transparent"
                  stroke={color}
                  strokeWidth={STROKE_WIDTH}
                  strokeDasharray={`${pct} ${100 - pct}`}
                  strokeDashoffset={dashOffset}
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-muted-foreground text-[10px] tracking-wide uppercase">Total value</span>
              <span className="text-lg font-semibold text-white">{formatUsd(totalValue)}</span>
            </div>
          </div>

          <ul className="flex w-full flex-col gap-2">
            {arcs.map(({ slice, color }) => (
              <li key={slice.asset} className="flex items-center gap-3 text-sm">
                <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
                <span className="font-medium text-white">{slice.symbol}</span>
                <span className="text-muted-foreground ml-auto tabular-nums">{formatUsd(slice.value)}</span>
                <span className="w-14 text-right text-white/90 tabular-nums">{(slice.fraction * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>
        {excludedNote}
      </CardContent>
    </Card>
  );
}
