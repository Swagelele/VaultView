export const prerender = false;

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonResponse, errorResponse, unauthorizedResponse } from "@/lib/api-helpers";
import { getHoldingAtLocation } from "@/lib/transaction-service";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return unauthorizedResponse();
  }

  const asset = context.url.searchParams.get("asset") ?? "";
  const location = context.url.searchParams.get("location") ?? "";

  if (!asset || !location) {
    return errorResponse("Missing asset or location parameter", 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return errorResponse("Supabase is not configured", 500);
  }

  const holding = await getHoldingAtLocation(supabase, context.locals.user.id, asset, location);
  return jsonResponse({ data: holding });
};
