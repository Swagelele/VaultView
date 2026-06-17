import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatUsd, pnlColor } from "@/lib/format";
import { computeSummary } from "@/lib/portfolio-summary";
import type { PortfolioAsset } from "@/types";

interface SummaryCardsProps {
  assets: PortfolioAsset[];
  totalFeesUsd: number;
}

interface SummaryCardProps {
  label: string;
  value: number | null;
  colored?: boolean;
}

function SummaryCard({ label, value, colored = false }: SummaryCardProps) {
  return (
    <Card>
      <CardContent>
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</span>
        <span className={cn("text-xl font-semibold text-white", colored && pnlColor(value))}>{formatUsd(value)}</span>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ assets, totalFeesUsd }: SummaryCardsProps) {
  const summary = computeSummary(assets, totalFeesUsd);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <SummaryCard label="Realized P&L" value={summary.total_realized_pnl_usd} colored />
      <SummaryCard label="Unrealized P&L" value={summary.total_unrealized_pnl_usd} colored />
      <SummaryCard label="Total Fees (USD)" value={summary.total_fees_usd} />
      <SummaryCard label="Net P&L" value={summary.net_pnl_usd} colored />
    </div>
  );
}
