import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssetAutocomplete } from "@/components/portfolio/AssetAutocomplete";
import { USD_STABLECOINS } from "@/lib/schemas";
import type { PortfolioAsset } from "@/types";

interface SellAllDialogProps {
  asset: PortfolioAsset;
  onClose: () => void;
  onSuccess: () => void;
}

interface LocationRow {
  location: string;
  quantity: number;
  selected: boolean;
  targetAsset: string;
  targetSymbol: string;
  fee: string;
}

function formatQty(value: number): string {
  if (value === 0) return "0";
  if (value < 0.0001) return value.toExponential(4);
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function SellAllDialog({ asset, onClose, onSuccess }: SellAllDialogProps) {
  const [rows, setRows] = useState<LocationRow[]>(() =>
    asset.locations
      .filter((l) => l.quantity > 0)
      .map((l) => ({
        location: l.location,
        quantity: l.quantity,
        selected: true,
        targetAsset: "usdt-tether",
        targetSymbol: "USDT",
        fee: "",
      })),
  );
  // Fall back to "" when current_price_usd is null (stale price) so the user types it in.
  const [price, setPrice] = useState(asset.current_price_usd !== null ? String(asset.current_price_usd) : "");
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 16));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function updateRow(index: number, patch: Partial<LocationRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const priceNum = Number(price);
  const selectedRows = rows.filter((r) => r.selected);
  const priceValid = Boolean(price) && priceNum > 0;
  const totalProceeds = priceValid ? selectedRows.reduce((sum, r) => sum + r.quantity * priceNum, 0) : null;
  const canSubmit = !submitting && selectedRows.length > 0 && priceValid;

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const payload = {
        source_asset: asset.asset,
        price: priceNum,
        transaction_date: new Date(transactionDate).toISOString(),
        locations: selectedRows.map((r) => ({
          location: r.location,
          target_asset: r.targetAsset,
          fee: r.fee ? Number(r.fee) : 0,
        })),
      };

      const res = await fetch("/api/transactions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        setError(data.error);
        return;
      }

      onSuccess();
    } catch {
      setError("Failed to create sell-all transactions");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sell all {asset.symbol}</DialogTitle>
          <DialogDescription>
            Sell {asset.symbol} across every location in one operation. Each location can receive a different USD
            stablecoin and carry its own fee.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Price per unit (USD)</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                }}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Date & Time</Label>
              <Input
                type="datetime-local"
                value={transactionDate}
                onChange={(e) => {
                  setTransactionDate(e.target.value);
                }}
                required
              />
            </div>
          </div>

          <div className="grid gap-3">
            {rows.map((row, i) => (
              <div
                key={row.location}
                className="grid gap-2 rounded-md border border-white/10 p-3"
                style={{ opacity: row.selected ? 1 : 0.5 }}
              >
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => {
                      updateRow(i, { selected: e.target.checked });
                    }}
                    className="rounded"
                  />
                  {row.location}
                  <span className="text-muted-foreground ml-auto font-normal">
                    {formatQty(row.quantity)} {asset.symbol}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <AssetAutocomplete
                    label="Receiving"
                    value={row.targetSymbol}
                    onChange={(id, sym) => {
                      updateRow(i, { targetAsset: id, targetSymbol: sym });
                    }}
                    filterIds={USD_STABLECOINS}
                    placeholder="Stablecoin..."
                    disabled={!row.selected}
                  />
                  <div className="grid gap-1.5">
                    <Label>Fee (optional)</Label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={row.fee}
                      onChange={(e) => {
                        updateRow(i, { fee: e.target.value });
                      }}
                      disabled={!row.selected}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-muted-foreground text-sm">
            {selectedRows.length === 0
              ? "Select at least one location to sell."
              : `Selling ${selectedRows.length} position${selectedRows.length > 1 ? "s" : ""}` +
                (totalProceeds !== null ? ` → ~$${totalProceeds.toLocaleString()} total proceeds` : "")}
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button type="submit" disabled={!canSubmit}>
            {submitting ? "Selling..." : "Sell All"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
