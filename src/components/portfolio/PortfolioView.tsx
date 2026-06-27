import { useState, useEffect, useRef } from "react";
import { AddTransactionDialog } from "@/components/portfolio/AddTransactionDialog";
import { AssetAllocationChart } from "@/components/portfolio/AssetAllocationChart";
import { PortfolioHistoryChart } from "@/components/portfolio/PortfolioHistoryChart";
import { PortfolioTable } from "@/components/portfolio/PortfolioTable";
import { SummaryCards } from "@/components/portfolio/SummaryCards";
import { computeAllocation } from "@/lib/asset-allocation";
import { computeSummary } from "@/lib/portfolio-summary";
import type { PortfolioAsset, PortfolioHistoryPoint, PortfolioHistoryResponse } from "@/types";

const REFRESH_INTERVAL_MS = 20_000;

interface PortfolioApiResponse {
  data: PortfolioAsset[];
  stale: boolean;
  updated_at: string | null;
  total_fees_usd: number;
}

function fetchPortfolioData(): Promise<PortfolioApiResponse | null> {
  return fetch("/api/portfolio")
    .then((res) => {
      if (res.status === 401) {
        window.location.href = "/auth/signin";
        return null;
      }
      return res.ok ? (res.json() as Promise<PortfolioApiResponse>) : null;
    })
    .catch(() => null);
}

function fetchPortfolioHistory(): Promise<PortfolioHistoryResponse | null> {
  return fetch("/api/portfolio/history")
    .then((res) => (res.ok ? (res.json() as Promise<PortfolioHistoryResponse>) : null))
    .catch(() => null);
}

export function PortfolioView() {
  const [assets, setAssets] = useState<PortfolioAsset[]>([]);
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [totalFees, setTotalFees] = useState(0);
  const [history, setHistory] = useState<PortfolioHistoryPoint[]>([]);
  const [excludedPriceDays, setExcludedPriceDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const assetsRef = useRef(assets);

  useEffect(() => {
    assetsRef.current = assets;
  });

  useEffect(() => {
    let cancelled = false;
    void fetchPortfolioData().then((data) => {
      if (cancelled || !data) return;
      setAssets(data.data);
      setStale(data.stale);
      setUpdatedAt(data.updated_at);
      setTotalFees(data.total_fees_usd);
      setLoading(false);
    });
    // History is fetched once and reshaped client-side on range/metric changes (no refetch). The
    // live final point ticks from the price poll without re-hitting this endpoint.
    void fetchPortfolioHistory().then((data) => {
      if (cancelled || !data) return;
      setHistory(data.data);
      setExcludedPriceDays(data.excluded_price_days);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || assets.length === 0) return;

    function refreshPrices() {
      const heldIds = assetsRef.current
        .filter((a) => a.total_quantity > 0 && a.current_price_usd !== null)
        .map((a) => a.asset);

      if (heldIds.length === 0) return;

      fetch(`/api/prices?ids=${encodeURIComponent(heldIds.join(","))}`)
        .then((res) =>
          res.ok
            ? (res.json() as Promise<{ data: Record<string, number>; stale: boolean; updated_at: string | null }>)
            : null,
        )
        .then((result) => {
          if (!result) return;
          setAssets((prev) =>
            prev.map((a) => {
              if (!(a.asset in result.data)) return a;
              const newPrice = result.data[a.asset];
              return {
                ...a,
                current_price_usd: newPrice,
                price_stale: result.stale,
                unrealized_pnl_usd: a.total_quantity > 0 ? a.total_quantity * (newPrice - a.avg_cost_usd) : null,
                locations: a.locations.map((loc) => ({
                  ...loc,
                  unrealized_pnl: loc.quantity > 0 ? loc.quantity * (newPrice - loc.avg_cost_usd) : 0,
                })),
              };
            }),
          );
          setStale(result.stale);
          setUpdatedAt(result.updated_at);
        })
        .catch(() => undefined);
    }

    function startPolling() {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(refreshPrices, REFRESH_INTERVAL_MS);
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        refreshPrices();
        startPolling();
      } else if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    startPolling();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loading, assets.length]);

  function handleTransactionCreated() {
    setLoading(true);
    void fetchPortfolioData().then((data) => {
      if (data) {
        setAssets(data.data);
        setStale(data.stale);
        setUpdatedAt(data.updated_at);
        setTotalFees(data.total_fees_usd);
      }
      setLoading(false);
    });
    // A new transaction changes the past reconstruction, so reshape the whole curve.
    void fetchPortfolioHistory().then((data) => {
      if (data) {
        setHistory(data.data);
        setExcludedPriceDays(data.excluded_price_days);
      }
    });
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-white/10"></div>
          <div className="h-9 w-36 animate-pulse rounded bg-white/10"></div>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-white/5"></div>
          ))}
        </div>
      </div>
    );
  }

  // Live "today" point for the history chart: value from the same definition as the allocation
  // donut's total, net P&L from the same definition as the summary card. Both derive from the
  // price-refreshed `assets`, so the chart's right edge ticks with the 20s poll. Null net P&L
  // (an unpriced held asset) → no override; the chart keeps the server's daily-close final point.
  const liveValue = computeAllocation(assets).totalValue;
  const liveNetPnl = computeSummary(assets, totalFees).net_pnl_usd;
  const liveToday = liveNetPnl !== null ? { value_usd: liveValue, total_pnl_usd: liveNetPnl } : null;

  return (
    <div className="space-y-4">
      <SummaryCards assets={assets} totalFeesUsd={totalFees} />
      {history.length > 0 && (
        <PortfolioHistoryChart history={history} liveToday={liveToday} excludedPriceDays={excludedPriceDays} />
      )}
      {assets.length > 0 && <AssetAllocationChart assets={assets} />}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => {
                setShowClosed(e.target.checked);
              }}
              className="rounded"
            />
            Show closed positions
          </label>
          {updatedAt && (
            <span className="text-muted-foreground text-xs">
              Last updated: {new Date(updatedAt).toLocaleTimeString()}
              {stale && <span className="ml-1 text-yellow-400">(stale)</span>}
            </span>
          )}
        </div>
        <AddTransactionDialog onTransactionCreated={handleTransactionCreated} />
      </div>

      {assets.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">
          No positions yet — add your first transaction to get started.
        </p>
      ) : (
        <PortfolioTable assets={assets} showClosed={showClosed} onSellAllSuccess={handleTransactionCreated} />
      )}
    </div>
  );
}
