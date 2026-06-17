import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetAutocomplete } from "@/components/portfolio/AssetAutocomplete";
import { USD_STABLECOINS } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type TxType = "DEPOSIT" | "BUY" | "SELL" | "WITHDRAW";

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
  // Async-fetched USD price of a non-stablecoin "counter" asset (the side whose quantity we derive
  // from the trade's USD value). The effective price (incl. the $1 stablecoin case) is derived below.
  const [fetchedCounterPrice, setFetchedCounterPrice] = useState<number | null>(null);
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
    // DEPOSIT and SELL price the source asset; BUY prices the target. Stablecoins skip (worth $1).
    const assetForPrice = type === "BUY" ? targetAsset : sourceAsset;
    if (!assetForPrice) return;
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

  useEffect(() => {
    // Resolve the counter asset's USD price so we can convert the trade's USD value into units of it
    // (e.g. how much ETH you receive for 2 BTC sold). BUY pays with the source; SELL receives the
    // target. Stablecoins are worth $1 and need no fetch — handled by the derived `counterPrice` below.
    if (type !== "BUY" && type !== "SELL") return;
    const counterAsset = type === "BUY" ? sourceAsset : targetAsset;
    if (!counterAsset || USD_STABLECOINS.includes(counterAsset)) return;

    let cancelled = false;
    const dateStr = transactionDate.slice(0, 10);
    fetch(`/api/prices?ids=${encodeURIComponent(counterAsset)}&date=${encodeURIComponent(dateStr)}`)
      .then((r) => r.json() as Promise<{ data: Record<string, number> }>)
      .then((d) => {
        if (cancelled) return;
        setFetchedCounterPrice(d.data[counterAsset] ?? null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      setFetchedCounterPrice(null);
    };
  }, [type, sourceAsset, targetAsset, transactionDate]);

  // The counter asset is the side whose quantity is derived from the trade's USD value: the paying
  // asset on a BUY, the received asset on a SELL. Stablecoins are worth $1; otherwise use the fetched
  // price. A crypto-to-crypto trade can't convert without it, so block submit until it resolves —
  // never fall back to $1 for a non-stablecoin, which is what produced the "120,000 ETH" bug.
  const counterAsset = type === "BUY" ? sourceAsset : type === "SELL" ? targetAsset : "";
  const counterIsStable = !!counterAsset && USD_STABLECOINS.includes(counterAsset);
  const counterPrice = counterIsStable ? 1 : fetchedCounterPrice;
  const tradeNeedsCounterPrice = !!counterAsset && !counterIsStable && (counterPrice === null || counterPrice <= 0);

  // Quantity of the *source* asset this trade consumes, in source units, for the balance check. For
  // BUY the user enters the bought (target) quantity and its USD price, so the source spent = USD cost
  // ÷ the paying asset's USD price (counterPrice). For SELL/WITHDRAW the entered amount already is the
  // source quantity. Paying with a stablecoin → counterPrice = $1, so this reduces to the USD cost.
  const sourceAmount =
    type === "BUY"
      ? amount && price && counterPrice && counterPrice > 0
        ? (Number(amount) * Number(price)) / counterPrice
        : 0
      : amount
        ? Number(amount)
        : 0;
  const insufficientBalance = type !== "DEPOSIT" && availableBalance !== null && sourceAmount > availableBalance;
  // S-05: a deposited stablecoin is worth $1 (no price field); any other deposited asset needs a
  // cost basis (suggested historical price or manual override) before it can be submitted.
  const isStablecoinDeposit = type === "DEPOSIT" && USD_STABLECOINS.includes(sourceAsset);
  const depositNeedsCostBasis =
    type === "DEPOSIT" && !isStablecoinDeposit && !!sourceAsset && (!price || Number(price) <= 0);
  // A purchase can't have happened in the future; mirror the server-side guard in the picker.
  const maxDate = new Date().toISOString().slice(0, 16);

  function resetForm() {
    setSourceAsset("");
    setSourceSymbol("");
    setTargetAsset("");
    setTargetSymbol("");
    setAmount("");
    setPrice("");
    setFee("");
    setSuggestedPrice(null);
    setFetchedCounterPrice(null);
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
      const deposit: Record<string, unknown> = {
        ...base,
        source_asset: sourceAsset,
        source_quantity: Number(amount),
      };
      // Non-stablecoin deposits carry a cost basis (suggested historical price or manual override);
      // stablecoins omit it and the server applies $1.
      if (!USD_STABLECOINS.includes(sourceAsset) && price && Number(price) > 0) {
        deposit.source_price_usd_override = Number(price);
      }
      return deposit;
    }

    if (type === "BUY") {
      const qty = Number(amount); // units of the asset being bought (target)
      const p = Number(price); // USD price per unit of the bought asset
      const counter = counterPrice ?? 1; // USD price of the paying (source) asset; stablecoin → $1
      return {
        ...base,
        source_asset: sourceAsset,
        // USD cost converted to units of the paying asset (qty*p USD ÷ its USD price).
        source_quantity: (qty * p) / counter,
        target_asset: targetAsset,
        target_quantity: qty,
        price: p,
        // Lock cost basis to the paying asset's USD price (resolvePriceUsd honours override first).
        source_price_usd_override: counter,
      };
    }

    if (type === "WITHDRAW") {
      // S-06: one-sided cash-out. Realizes P&L on the source against average cost. Non-stablecoin
      // withdrawals carry the accepted/overridden current price; stablecoins omit it (server → $1).
      const withdraw: Record<string, unknown> = {
        ...base,
        source_asset: sourceAsset,
        source_quantity: Number(amount),
      };
      if (!USD_STABLECOINS.includes(sourceAsset) && price && Number(price) > 0) {
        withdraw.source_price_usd_override = Number(price);
      }
      return withdraw;
    }

    // SELL (and the unused SWAP fallthrough): dispose `qty` of the source at `p` USD each, receiving the
    // target. target_quantity must be in *units of the target asset*, so convert the USD proceeds by the
    // target's USD price (stablecoin → $1). Storing the USD proceeds directly was the "120,000 ETH" bug.
    const qty = Number(amount); // units of the source asset being sold
    const p = Number(price); // USD price per unit of the sold asset
    const counter = counterPrice ?? 1; // USD price of the received (target) asset; stablecoin → $1
    return {
      ...base,
      source_asset: sourceAsset,
      source_quantity: qty,
      target_asset: targetAsset,
      target_quantity: (qty * p) / counter,
      price: p,
      // Lock realized P&L to the sale price the user actually saw (override wins in resolvePriceUsd).
      source_price_usd_override: p,
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
      ? `Total cost: $${(Number(amount) * Number(price)).toLocaleString()}`
      : type === "SELL" && amount && price
        ? `Proceeds: $${(Number(amount) * Number(price)).toLocaleString()}`
        : type === "WITHDRAW" && amount && price
          ? `Withdrawn value: $${(Number(amount) * Number(price)).toLocaleString()}`
          : null;

  // For a crypto-to-crypto trade, show the derived counter-asset amount so the units are unambiguous.
  const counterEstimate =
    (type === "BUY" || type === "SELL") &&
    amount &&
    price &&
    counterPrice &&
    counterPrice > 0 &&
    !!counterAsset &&
    !USD_STABLECOINS.includes(counterAsset)
      ? `${type === "SELL" ? "You receive" : "You pay"} ≈ ${(
          (Number(amount) * Number(price)) /
          counterPrice
        ).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${type === "SELL" ? targetSymbol : sourceSymbol}`
      : null;

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <Tabs value={type} onValueChange={handleTypeChange}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="DEPOSIT">Deposit</TabsTrigger>
          <TabsTrigger value="BUY">Buy</TabsTrigger>
          <TabsTrigger value="SELL">Sell</TabsTrigger>
          <TabsTrigger value="WITHDRAW">Withdraw</TabsTrigger>
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
            label="Asset"
            value={sourceSymbol}
            onChange={(id, sym) => {
              setSourceAsset(id);
              setSourceSymbol(sym);
            }}
            placeholder="Search asset..."
          />
          {!isStablecoinDeposit && sourceAsset && (
            <div className="grid gap-1.5">
              <Label>
                Cost basis price per unit (USD)
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
          )}
        </>
      )}

      {type === "BUY" && (
        <>
          <AssetAutocomplete
            label="Buy asset"
            value={targetSymbol}
            onChange={(id, sym) => {
              setTargetAsset(id);
              setTargetSymbol(sym);
            }}
            placeholder="Search asset..."
          />
          <AssetAutocomplete
            label="Paying with"
            value={sourceSymbol}
            onChange={(id, sym) => {
              setSourceAsset(id);
              setSourceSymbol(sym);
            }}
            placeholder="Search asset..."
          />
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
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Quantity</Label>
              <button
                type="button"
                className={cn(
                  "text-primary cursor-pointer text-xs hover:underline",
                  (availableBalance === null ||
                    availableBalance <= 0 ||
                    !price ||
                    Number(price) <= 0 ||
                    !counterPrice ||
                    counterPrice <= 0) &&
                    "cursor-not-allowed opacity-50",
                )}
                disabled={
                  availableBalance === null ||
                  availableBalance <= 0 ||
                  !price ||
                  Number(price) <= 0 ||
                  !counterPrice ||
                  counterPrice <= 0
                }
                onClick={() => {
                  if (
                    availableBalance !== null &&
                    availableBalance > 0 &&
                    price &&
                    Number(price) > 0 &&
                    counterPrice &&
                    counterPrice > 0
                  ) {
                    // Max buyable = (paying balance × paying-asset USD price) ÷ bought-asset USD price.
                    setAmount(String((availableBalance * counterPrice) / Number(price)));
                  }
                }}
              >
                Max
              </button>
            </div>
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
          {availableBalance !== null && (
            <p className={insufficientBalance ? "text-sm text-red-500" : "text-muted-foreground text-sm"}>
              Available: {availableBalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} {sourceSymbol}
              {insufficientBalance && " — insufficient balance"}
            </p>
          )}
          {computedTotal && <p className="text-muted-foreground text-sm">{computedTotal}</p>}
          {counterEstimate && <p className="text-muted-foreground text-sm">{counterEstimate}</p>}
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
        </>
      )}

      {type === "SELL" && (
        <>
          <AssetAutocomplete
            label="Sell asset"
            value={sourceSymbol}
            onChange={(id, sym) => {
              setSourceAsset(id);
              setSourceSymbol(sym);
            }}
            placeholder="Search asset..."
          />
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
            <div className="flex items-center justify-between">
              <Label>Quantity</Label>
              <button
                type="button"
                className={cn(
                  "text-primary cursor-pointer text-xs hover:underline",
                  (availableBalance === null || availableBalance <= 0) && "cursor-not-allowed opacity-50",
                )}
                disabled={availableBalance === null || availableBalance <= 0}
                onClick={() => {
                  if (availableBalance !== null && availableBalance > 0) {
                    setAmount(String(availableBalance));
                  }
                }}
              >
                Max
              </button>
            </div>
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
            label="Receiving"
            value={targetSymbol}
            onChange={(id, sym) => {
              setTargetAsset(id);
              setTargetSymbol(sym);
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
          {counterEstimate && <p className="text-muted-foreground text-sm">{counterEstimate}</p>}
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
        </>
      )}

      {type === "WITHDRAW" && (
        <>
          <AssetAutocomplete
            label="Withdraw asset"
            value={sourceSymbol}
            onChange={(id, sym) => {
              setSourceAsset(id);
              setSourceSymbol(sym);
            }}
            placeholder="Search asset..."
          />
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
            <div className="flex items-center justify-between">
              <Label>Quantity</Label>
              <button
                type="button"
                className={cn(
                  "text-primary cursor-pointer text-xs hover:underline",
                  (availableBalance === null || availableBalance <= 0) && "cursor-not-allowed opacity-50",
                )}
                disabled={availableBalance === null || availableBalance <= 0}
                onClick={() => {
                  if (availableBalance !== null && availableBalance > 0) {
                    setAmount(String(availableBalance));
                  }
                }}
              >
                Max
              </button>
            </div>
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
          {sourceAsset && !USD_STABLECOINS.includes(sourceAsset) && (
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
          )}
          {availableBalance !== null && (
            <p className={insufficientBalance ? "text-sm text-red-500" : "text-muted-foreground text-sm"}>
              Available: {availableBalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} {sourceSymbol}
              {insufficientBalance && " — insufficient balance"}
            </p>
          )}
          {computedTotal && <p className="text-muted-foreground text-sm">{computedTotal}</p>}
          <div className="grid gap-1.5">
            <Label>Date & Time</Label>
            <Input
              type="datetime-local"
              value={transactionDate}
              max={maxDate}
              onChange={(e) => {
                setTransactionDate(e.target.value);
              }}
              required
            />
          </div>
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
        </>
      )}

      {type === "DEPOSIT" && (
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
      )}

      {type === "DEPOSIT" && (
        <div className="grid gap-1.5">
          <Label>Date & Time</Label>
          <Input
            type="datetime-local"
            value={transactionDate}
            max={maxDate}
            onChange={(e) => {
              setTransactionDate(e.target.value);
            }}
            required
          />
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        type="submit"
        disabled={submitting || insufficientBalance || depositNeedsCostBasis || tradeNeedsCounterPrice}
      >
        {submitting ? "Saving..." : "Save Transaction"}
      </Button>
    </form>
  );
}
