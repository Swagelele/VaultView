import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/format";
import {
  sliceRange,
  buildLinePath,
  formatChartDate,
  CHART_RANGES,
  type ChartRange,
} from "@/lib/portfolio-history-chart";
import type { PortfolioHistoryPoint } from "@/types";

// Fixed SVG coordinate space; the element stretches to the container width (preserveAspectRatio none).
const VIEW_W = 800;
const VIEW_H = 220;
// Vertical inset (viewBox units) so the line's stroke never clips against the top/bottom edge.
const VIEW_PAD = 10;

type Metric = "value" | "pnl";

const METRIC_LABEL: Record<Metric, string> = {
  value: "Portfolio Value",
  pnl: "Total P&L",
};

interface PortfolioHistoryChartProps {
  history: PortfolioHistoryPoint[];
  // Live "today" totals from PortfolioView's price poll — override the series' final point so the
  // right edge ticks with the 20s refresh instead of resting on yesterday's daily close.
  liveToday: { value_usd: number; total_pnl_usd: number } | null;
  excludedPriceDays: number;
}

export function PortfolioHistoryChart({ history, liveToday, excludedPriceDays }: PortfolioHistoryChartProps) {
  const [metric, setMetric] = useState<Metric>("value");
  const [range, setRange] = useState<ChartRange>("365d");
  // Index of the daily point the cursor is nearest, or null when not hovering. Drives the crosshair.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Override the final point with the live totals (kept pure — produces a new array, no mutation).
  const points =
    liveToday && history.length > 0
      ? history.map((p, i) =>
          i === history.length - 1
            ? { ...p, value_usd: liveToday.value_usd, total_pnl_usd: liveToday.total_pnl_usd }
            : p,
        )
      : history;

  const sliced = sliceRange(points, range);
  const values = sliced.map((p) => (metric === "value" ? p.value_usd : p.total_pnl_usd));
  const { path, areaPath, min, max, points: vertices } = buildLinePath(values, VIEW_W, VIEW_H, VIEW_PAD);

  // The hovered vertex (guarded against a stale index after the range shrinks the series).
  const hoveredVertex = hoveredIndex !== null && hoveredIndex < vertices.length ? vertices[hoveredIndex] : undefined;

  const handleHoverMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const i = Math.round(fx * (sliced.length - 1));
    setHoveredIndex(Math.min(sliced.length - 1, Math.max(0, i)));
  };

  // P&L line is tinted by the sign of its latest point; value line is a steady accent.
  const latest = values[values.length - 1] ?? 0;
  const lineColor = metric === "pnl" ? (latest >= 0 ? "#4ade80" : "#f87171") : "#38bdf8";

  const excludedNote =
    excludedPriceDays > 0 ? (
      <p className="text-muted-foreground mt-3 text-xs">
        {excludedPriceDays} asset-day{excludedPriceDays === 1 ? "" : "s"} had no price and counted as $0.
      </p>
    ) : null;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1" role="group" aria-label="Metric">
        {(["value", "pnl"] as Metric[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMetric(m);
            }}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              metric === m ? "bg-white/15 text-white" : "text-muted-foreground hover:text-white",
            )}
          >
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="flex gap-1" role="group" aria-label="Time range">
        {CHART_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              setRange(r);
              setHoveredIndex(null);
            }}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium tabular-nums transition-colors",
              range === r ? "bg-white/15 text-white" : "text-muted-foreground hover:text-white",
            )}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Card>
      <CardContent>
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">History</span>
        <div className="mt-2 space-y-3">
          {header}

          {sliced.length < 2 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">Not enough history to chart yet.</p>
          ) : (
            <div>
              {/* Value labels are absolutely positioned over the SVG only; the date row is a sibling
                  below so the min-value label never collides with the start-date label. */}
              <div
                className="relative"
                onMouseMove={handleHoverMove}
                onMouseLeave={() => {
                  setHoveredIndex(null);
                }}
              >
                <div className="text-muted-foreground absolute top-0 left-0 rounded bg-black/40 px-1 text-[10px] tabular-nums">
                  {formatUsd(max)}
                </div>
                <div className="text-muted-foreground absolute bottom-0 left-0 rounded bg-black/40 px-1 text-[10px] tabular-nums">
                  {formatUsd(min)}
                </div>
                <svg
                  viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                  preserveAspectRatio="none"
                  className="h-48 w-full"
                  role="img"
                  aria-label={`${METRIC_LABEL[metric]} over ${range}`}
                >
                  <path d={areaPath} fill={lineColor} fillOpacity={0.12} stroke="none" />
                  <path
                    d={path}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </svg>

                {hoveredVertex &&
                  hoveredIndex !== null &&
                  (() => {
                    // Percentages map the viewBox vertex into the wrapper, which the SVG fills exactly.
                    const xPct = (hoveredVertex.x / VIEW_W) * 100;
                    const yPct = (hoveredVertex.y / VIEW_H) * 100;
                    // Three-zone horizontal anchor so the tooltip never clips at the chart's edges.
                    const anchorX = xPct < 15 ? "0%" : xPct > 85 ? "-100%" : "-50%";
                    return (
                      <>
                        {/* Vertical guide line at the hovered day. */}
                        <div
                          className="bg-muted-foreground/30 pointer-events-none absolute top-0 bottom-0 w-px"
                          style={{ left: `${xPct}%` }}
                        />
                        {/* Dot pinned to the curve vertex. */}
                        <div
                          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-black/40"
                          style={{ left: `${xPct}%`, top: `${yPct}%`, backgroundColor: lineColor }}
                        />
                        {/* Tooltip below the point: friendly date + active-metric value. */}
                        <div
                          className="pointer-events-none absolute rounded bg-black/70 px-1.5 py-0.5 text-[10px] whitespace-nowrap tabular-nums"
                          style={{ left: `${xPct}%`, top: `calc(${yPct}% + 8px)`, transform: `translateX(${anchorX})` }}
                        >
                          <span className="text-muted-foreground">{formatChartDate(sliced[hoveredIndex].date)}</span>
                          <span className="mx-1 text-white/30">·</span>
                          <span className="font-medium text-white">{formatUsd(values[hoveredIndex])}</span>
                        </div>
                      </>
                    );
                  })()}
              </div>
              <div className="text-muted-foreground mt-1 flex justify-between text-[10px] tabular-nums">
                <span>{sliced[0].date}</span>
                <span>{sliced[sliced.length - 1].date}</span>
              </div>
            </div>
          )}
        </div>
        {excludedNote}
      </CardContent>
    </Card>
  );
}
