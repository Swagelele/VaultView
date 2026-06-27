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

  const coinIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (coinIds.length === 0) {
    return errorResponse("Missing ids parameter", 400);
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
