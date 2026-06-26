export const prerender = false;

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonResponse, errorResponse, unauthorizedResponse } from "@/lib/api-helpers";
import { getPortfolioHistory } from "@/lib/portfolio-history-service";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return unauthorizedResponse();
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return errorResponse("Supabase is not configured", 500);
  }

  const result = await getPortfolioHistory(supabase, context.locals.user.id);
  return jsonResponse(result);
};
