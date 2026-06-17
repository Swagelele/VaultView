import { useEffect, useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatQty, formatUsd, pnlColor, symbolFromId } from "@/lib/format";
import type { TransactionType, TransactionWithPnl } from "@/types";

const ALL = "ALL";

// Canonical display order for the type filter; only types actually present are shown.
const TYPE_ORDER: TransactionType[] = ["BUY", "SELL", "SWAP", "DEPOSIT", "WITHDRAW"];

// Tailwind text/border accents per type, applied over the Badge `outline` variant.
const TYPE_STYLES: Record<TransactionType, string> = {
  BUY: "text-green-400 border-green-400/30",
  SELL: "text-red-400 border-red-400/30",
  SWAP: "text-blue-400 border-blue-400/30",
  DEPOSIT: "text-emerald-400 border-emerald-400/30",
  WITHDRAW: "text-orange-400 border-orange-400/30",
};

interface TransactionsApiResponse {
  data: TransactionWithPnl[];
}

function fetchTransactions(): Promise<TransactionsApiResponse | null> {
  return fetch("/api/transactions")
    .then((res) => {
      if (res.status === 401) {
        window.location.href = "/auth/signin";
        return null;
      }
      return res.ok ? (res.json() as Promise<TransactionsApiResponse>) : null;
    })
    .catch(() => null);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TransactionList() {
  const [transactions, setTransactions] = useState<TransactionWithPnl[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [locationFilter, setLocationFilter] = useState<string>(ALL);
  const [assetFilter, setAssetFilter] = useState<string>(ALL);

  useEffect(() => {
    let cancelled = false;
    void fetchTransactions().then((res) => {
      if (cancelled || !res) return;
      setTransactions(res.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter option lists derived from the loaded data (FR-011): no dead options.
  const typeOptions = useMemo(() => {
    const present = new Set(transactions.map((t) => t.type));
    return TYPE_ORDER.filter((t) => present.has(t));
  }, [transactions]);

  const locationOptions = useMemo(() => {
    return [...new Set(transactions.map((t) => t.location))].sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const assetOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const t of transactions) {
      ids.add(t.source_asset);
      if (t.target_asset) ids.add(t.target_asset);
    }
    return [...ids].sort((a, b) => symbolFromId(a).localeCompare(symbolFromId(b)));
  }, [transactions]);

  // AND across the three filters; the asset filter matches either side of a trade.
  const visible = useMemo(() => {
    const filtered = transactions.filter((t) => {
      if (typeFilter !== ALL && t.type !== typeFilter) return false;
      if (locationFilter !== ALL && t.location !== locationFilter) return false;
      if (assetFilter !== ALL && t.source_asset !== assetFilter && t.target_asset !== assetFilter) return false;
      return true;
    });
    // Newest first — reverse of the engine's chronological order.
    return [...filtered].sort((a, b) => {
      const byDate = new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime();
      if (byDate !== 0) return byDate;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [transactions, typeFilter, locationFilter, assetFilter]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-white/5"></div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={typeOptions.map((t) => ({ value: t, label: t }))}
        />
        <FilterSelect
          label="Location"
          value={locationFilter}
          onChange={setLocationFilter}
          options={locationOptions.map((l) => ({ value: l, label: l }))}
        />
        <FilterSelect
          label="Asset"
          value={assetFilter}
          onChange={setAssetFilter}
          options={assetOptions.map((id) => ({ value: id, label: symbolFromId(id) }))}
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">
          {transactions.length === 0
            ? "No transactions yet — add your first transaction from the dashboard."
            : "No matching transactions for the selected filters."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-white/10">
              <TableHead className="text-white/70">Date</TableHead>
              <TableHead className="text-white/70">Type</TableHead>
              <TableHead className="text-white/70">Source</TableHead>
              <TableHead className="text-white/70">Target</TableHead>
              <TableHead className="text-right text-white/70">Price</TableHead>
              <TableHead className="text-right text-white/70">Fee</TableHead>
              <TableHead className="text-white/70">Location</TableHead>
              <TableHead className="text-right text-white/70">Unrealized P&L</TableHead>
              <TableHead className="text-right text-white/70">Realized P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((t) => (
              <TableRow key={t.id} className="border-white/10 hover:bg-white/5">
                <TableCell className="text-white/70">{formatDate(t.transaction_date)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(TYPE_STYLES[t.type])}>
                    {t.type}
                  </Badge>
                </TableCell>
                <TableCell className="text-white/90">
                  {formatQty(t.source_quantity)} {symbolFromId(t.source_asset)}
                </TableCell>
                <TableCell className="text-white/90">
                  {t.target_asset && t.target_quantity !== null
                    ? `${formatQty(t.target_quantity)} ${symbolFromId(t.target_asset)}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right text-white/90">{formatUsd(t.price_usd)}</TableCell>
                <TableCell className="text-right text-white/90">{formatUsd(t.fee)}</TableCell>
                <TableCell className="text-white/90">{t.location}</TableCell>
                <TableCell className={cn("text-right", pnlColor(t.unrealized_pnl_usd))}>
                  {formatUsd(t.unrealized_pnl_usd)}
                </TableCell>
                <TableCell className={cn("text-right", pnlColor(t.realized_pnl_usd))}>
                  {formatUsd(t.realized_pnl_usd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-white/70">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="min-w-32 border-white/15 bg-white/5 text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
