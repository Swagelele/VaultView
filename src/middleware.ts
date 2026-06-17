import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_PAGES = ["/dashboard", "/transactions"];

const PROTECTED_API_ROUTES = [
  "/api/transactions",
  "/api/portfolio",
  "/api/locations",
  "/api/holdings",
  "/api/assets/search",
  "/api/prices",
];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const { pathname } = context.url;

  if (PROTECTED_API_ROUTES.some((route) => pathname.startsWith(route))) {
    if (!context.locals.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (PROTECTED_PAGES.some((route) => pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
