import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetAutocomplete } from "@/components/portfolio/AssetAutocomplete";
import { USD_STABLECOINS } from "@/lib/schemas";

type TxType = "DEPOSIT" | "BUY" | "SELL";

interface TransactionFormProps {
  onSuccess: () => void;
}

export function TransactionForm({ onSuccess }: TransactionFormProps) {
  const [type, setType] = useState<TxType>("DEPOSIT");
  const [sourceAsset, setSourceAsset] = useState("");
  const [sourceSymbol, setSourceSymbol] = useState("");
  const [targetAsset, setTargetAsset] = useState("");
  const [targetSymbol, setTargetSymbol] = useState("");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [location, setLocation] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 16));
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);

  useEffect(() => {
    if (type === "DEPOSIT" || !sourceAsset || !location) return;

    let cancelled = false;
    fetch(`/api/holdings?asset=${encodeURIComponent(sourceAsset)}&location=${encodeURIComponent(location)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ data: number }>) : null))
      .then((d) => {
        if (!cancelled && d) setAvailableBalance(d.data);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      setAvailableBalance(null);
    };
  }, [sourceAsset, location, type]);

  useEffect(() => {
    fetch("/api/locations")
      .then((r) => r.json() as Promise<{ data: string[] }>)
      .then((d) => {
        setLocationSuggestions(d.data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const assetForPrice = type === "BUY" ? targetAsset : sourceAsset;
    if (!assetForPrice || type === "DEPOSIT") return;
    if (USD_STABLECOINS.includes(assetForPrice)) return;

    let cancelled = false;
    const dateStr = transactionDate.slice(0, 10);
    fetch(`/api/prices?ids=${encodeURIComponent(assetForPrice)}&date=${encodeURIComponent(dateStr)}`)
      .then((r) => r.json() as Promise<{ data: Record<string, number> }>)
      .then((d) => {
        if (cancelled) return;
        const p = d.data[assetForPrice];
        if (p) {
          setSuggestedPrice(p);
          setPrice(String(Math.round(p * 100) / 100));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      setSuggestedPrice(null);
      setPrice("");
    };
  }, [sourceAsset, targetAsset, type, transactionDate]);

  const sourceAmount = type === "BUY" && amount && price ? Number(amount) * Number(price) : amount ? Number(amount) : 0;
  const insufficientBalance = type !== "DEPOSIT" && availableBalance !== null && sourceAmount > availableBalance;

  function resetForm() {
    setSourceAsset("");
    setSourceSymbol("");
    setTargetAsset("");
    setTargetSymbol("");
    setAmount("");
    setPrice("");
    setFee("");
    setSuggestedPrice(null);
    setAvailableBalance(null);
    setError("");
  }

  function handleTypeChange(t: string) {
    setType(t as TxType);
    resetForm();
  }

  function buildPayload() {
    const base = {
      type,
      location,
      transaction_date: new Date(transactionDate).toISOString(),
      fee: fee ? Number(fee) : 0,
    };

    if (type === "DEPOSIT") {
      return { ...base, source_asset: sourceAsset, source_quantity: Number(amount) };
    }

    if (type === "BUY") {
      const qty = Number(amount);
      const p = Number(price);
      return {
        ...base,
        source_asset: sourceAsset,
        source_quantity: qty * p,
        target_asset: targetAsset,
        target_quantity: qty,
        price: p,
      };
    }

    const qty = Number(amount);
    const p = Number(price);
    return {
      ...base,
      source_asset: sourceAsset,
      source_quantity: qty,
      target_asset: targetAsset,
      target_quantity: qty * p,
      price: p,
    };
  }

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const payload = buildPayload();
      const res = await fetch("/api/transactions", {
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
      setError("Failed to create transaction");
    } finally {
      setSubmitting(false);
    }
  }

  const computedTotal =
    type === "BUY" && amount && price
      ? `Total cost: $${(Number(amount) * Number(price)).toLocaleString()} ${sourceSymbol}`
      : type === "SELL" && amount && price
        ? `Proceeds: $${(Number(amount) * Number(price)).toLocaleString()} ${targetSymbol}`
        : null;

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <Tabs value={type} onValueChange={handleTypeChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="DEPOSIT">Deposit</TabsTrigger>
          <TabsTrigger value="BUY">Buy</TabsTrigger>
          <TabsTrigger value="SELL">Sell</TabsTrigger>
        </TabsList>
      </Tabs>

      {type === "DEPOSIT" && (
        <>
          <div className="grid gap-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              required
            />
          </div>
          <AssetAutocomplete
            label="Stablecoin"
            value={sourceSymbol}
            onChange={(id, sym) => {
              setSourceAsset(id);
              setSourceSymbol(sym);
            }}
            filterIds={USD_STABLECOINS}
            placeholder="Search stablecoin..."
          />
        </>
      )}

      {(type === "BUY" || type === "SELL") && (
        <>
          <AssetAutocomplete
            label={type === "BUY" ? "Buy asset" : "Sell asset"}
            value={type === "BUY" ? targetSymbol : sourceSymbol}
            onChange={(id, sym) => {
              if (type === "BUY") {
                setTargetAsset(id);
                setTargetSymbol(sym);
              } else {
                setSourceAsset(id);
                setSourceSymbol(sym);
              }
            }}
            placeholder="Search asset..."
          />
          <div className="grid gap-1.5">
            <Label>Quantity</Label>
            <Input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label>
              Price per unit (USD)
              {suggestedPrice !== null && <span className="text-muted-foreground ml-1">(suggested)</span>}
            </Label>
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
          <AssetAutocomplete
            label={type === "BUY" ? "Paying with" : "Receiving"}
            value={type === "BUY" ? sourceSymbol : targetSymbol}
            onChange={(id, sym) => {
              if (type === "BUY") {
                setSourceAsset(id);
                setSourceSymbol(sym);
              } else {
                setTargetAsset(id);
                setTargetSymbol(sym);
              }
            }}
            placeholder="Search asset..."
          />
          {availableBalance !== null && (
            <p className={insufficientBalance ? "text-sm text-red-500" : "text-muted-foreground text-sm"}>
              Available: {availableBalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} {sourceSymbol}
              {insufficientBalance && " — insufficient balance"}
            </p>
          )}
          {computedTotal && <p className="text-muted-foreground text-sm">{computedTotal}</p>}
        </>
      )}

      <div className="grid gap-1.5">
        <Label>Location</Label>
        <Input
          type="text"
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
          }}
          list="location-suggestions"
          placeholder="e.g. Binance, MetaMask..."
          required
        />
        <datalist id="location-suggestions">
          {locationSuggestions.map((loc) => (
            <option key={loc} value={loc} />
          ))}
        </datalist>
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

      {type !== "DEPOSIT" && (
        <div className="grid gap-1.5">
          <Label>Fee (optional)</Label>
          <Input
            type="number"
            step="any"
            min="0"
            value={fee}
            onChange={(e) => {
              setFee(e.target.value);
            }}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button type="submit" disabled={submitting || insufficientBalance}>
        {submitting ? "Saving..." : "Save Transaction"}
      </Button>
    </form>
  );
}
