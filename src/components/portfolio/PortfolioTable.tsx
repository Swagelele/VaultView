import { Fragment, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PortfolioAsset } from "@/types";

interface PortfolioTableProps {
  assets: PortfolioAsset[];
  showClosed: boolean;
}

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQty(value: number): string {
  if (value === 0) return "0";
  if (value < 0.0001) return value.toExponential(4);
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function pnlColor(value: number | null): string {
  if (value === null || value === 0) return "";
  return value > 0 ? "text-green-400" : "text-red-400";
}

export function PortfolioTable({ assets, showClosed }: PortfolioTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visible = showClosed ? assets : assets.filter((a) => !a.is_closed);

  function toggleExpand(asset: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(asset)) {
        next.delete(asset);
      } else {
        next.add(asset);
      }
      return next;
    });
  }

  if (visible.length === 0) {
    return <p className="text-muted-foreground py-8 text-center">No positions to display.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-white/10">
          <TableHead className="w-8 text-white/70"></TableHead>
          <TableHead className="text-white/70">Asset</TableHead>
          <TableHead className="text-right text-white/70">Quantity</TableHead>
          <TableHead className="text-right text-white/70">Avg Cost</TableHead>
          <TableHead className="text-right text-white/70">Current Price</TableHead>
          <TableHead className="text-right text-white/70">Value</TableHead>
          <TableHead className="text-right text-white/70">Unrealized P&L</TableHead>
          <TableHead className="text-right text-white/70">Realized P&L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((a) => (
          <Fragment key={a.asset}>
            <TableRow
              className={cn("cursor-pointer border-white/10 hover:bg-white/5", a.is_closed && "opacity-50")}
              onClick={() => {
                toggleExpand(a.asset);
              }}
            >
              <TableCell className="w-8 pr-0">
                <ChevronRightIcon className={cn("size-4 transition-transform", expanded.has(a.asset) && "rotate-90")} />
              </TableCell>
              <TableCell className="font-medium text-white">{a.symbol}</TableCell>
              <TableCell className="text-right text-white/90">{formatQty(a.total_quantity)}</TableCell>
              <TableCell className="text-right text-white/90">{formatUsd(a.avg_cost_usd)}</TableCell>
              <TableCell className="text-right text-white/90">{formatUsd(a.current_price_usd)}</TableCell>
              <TableCell className="text-right text-white/90">
                {formatUsd(a.current_price_usd !== null ? a.total_quantity * a.current_price_usd : null)}
              </TableCell>
              <TableCell className={cn("text-right", pnlColor(a.unrealized_pnl_usd))}>
                {formatUsd(a.unrealized_pnl_usd)}
              </TableCell>
              <TableCell className={cn("text-right", pnlColor(a.total_realized_pnl_usd))}>
                {formatUsd(a.total_realized_pnl_usd)}
              </TableCell>
            </TableRow>
            {expanded.has(a.asset) &&
              a.locations.map((loc) => (
                <TableRow key={`${a.asset}-${loc.location}`} className="border-white/5 bg-white/[0.02]">
                  <TableCell></TableCell>
                  <TableCell className="text-muted-foreground pl-8 text-sm">{loc.location}</TableCell>
                  <TableCell className="text-muted-foreground text-right text-sm">{formatQty(loc.quantity)}</TableCell>
                  <TableCell className="text-muted-foreground text-right text-sm">
                    {formatUsd(loc.avg_cost_usd)}
                  </TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-muted-foreground text-right text-sm">
                    {formatUsd(a.current_price_usd !== null ? loc.quantity * a.current_price_usd : null)}
                  </TableCell>
                  <TableCell className={cn("text-right text-sm", pnlColor(loc.unrealized_pnl))}>
                    {formatUsd(loc.unrealized_pnl)}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
