import { useState, useEffect, useRef } from "react";
import { AddTransactionDialog } from "@/components/portfolio/AddTransactionDialog";
import { PortfolioTable } from "@/components/portfolio/PortfolioTable";
import type { PortfolioAsset } from "@/types";

const REFRESH_INTERVAL_MS = 20_000;

interface PortfolioApiResponse {
  data: PortfolioAsset[];
  stale: boolean;
  updated_at: string | null;
}

function fetchPortfolioData(): Promise<PortfolioApiResponse | null> {
  return fetch("/api/portfolio")
    .then((res) => (res.ok ? (res.json() as Promise<PortfolioApiResponse>) : null))
    .catch(() => null);
}

export function PortfolioView() {
  const [assets, setAssets] = useState<PortfolioAsset[]>([]);
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
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
      setLoading(false);
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
      }
      setLoading(false);
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

  return (
    <div className="space-y-4">
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
        <PortfolioTable assets={assets} showClosed={showClosed} />
      )}
    </div>
  );
}
