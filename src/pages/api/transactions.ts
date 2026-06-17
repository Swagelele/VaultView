export const prerender = false;

import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonResponse, errorResponse, unauthorizedResponse } from "@/lib/api-helpers";
import { createTransaction, getTransactionsWithPnl } from "@/lib/transaction-service";

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return unauthorizedResponse();
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return errorResponse("Supabase is not configured", 500);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const result = await createTransaction(supabase, context.locals.user.id, body);

  if (result.error) {
    return errorResponse(result.error, result.status ?? 400);
  }

  return jsonResponse({ data: result.data }, 201);
};

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return unauthorizedResponse();
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return errorResponse("Supabase is not configured", 500);
  }

  const transactions = await getTransactionsWithPnl(supabase, context.locals.user.id);
  return jsonResponse({ data: transactions });
};
