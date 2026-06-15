export const prerender = false;

import type { APIRoute } from "astro";
import { searchCoins } from "@/lib/coinpaprika";
import { jsonResponse, unauthorizedResponse } from "@/lib/api-helpers";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return unauthorizedResponse();
  }

  const query = context.url.searchParams.get("q") ?? "";
  if (query.length < 2) {
    return jsonResponse({ data: [] });
  }

  const results = await searchCoins(query);
  return jsonResponse({ data: results });
};
