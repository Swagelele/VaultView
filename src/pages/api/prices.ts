export const prerender = false;

import type { APIRoute } from "astro";
import { getMultiplePrices, getHistoricalPrice } from "@/lib/prices";
import { jsonResponse, errorResponse, unauthorizedResponse } from "@/lib/api-helpers";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return unauthorizedResponse();
  }

  const idsParam = context.url.searchParams.get("ids") ?? "";
  const date = context.url.searchParams.get("date");

  // Sanitize ids to a plausible ticker charset (defense in depth — they flow into the upstream
  // price URL; the adapter already encodes + degrades unknowns to null). Not allowlisted against the
  // static asset list so a held-but-delisted asset can still be priced.
  const coinIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9]{1,15}$/.test(id));

  if (coinIds.length === 0) {
    return errorResponse("Missing or invalid ids parameter", 400);
  }

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse("Invalid date format (expected YYYY-MM-DD)", 400);
  }

  if (date) {
    const prices: Record<string, number> = {};
    const results = await Promise.all(
      coinIds.map(async (id) => {
        const price = await getHistoricalPrice(id, date);
        return { id, price };
      }),
    );

    for (const { id, price } of results) {
      if (price !== null) {
        prices[id] = price;
      }
    }

    return jsonResponse({ data: prices, stale: false, updated_at: null });
  }

  const result = await getMultiplePrices(coinIds);
  return jsonResponse({
    data: result.prices,
    stale: result.stale,
    updated_at: result.updated_at,
  });
};
