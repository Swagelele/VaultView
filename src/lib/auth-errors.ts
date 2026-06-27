import type { AuthError } from "@supabase/supabase-js";

const FALLBACK_MESSAGE = "Service temporarily unavailable — please try again in a moment.";

/**
 * Supabase returns an opaque error (message `"{}"` or empty) when the backend
 * is unreachable — e.g. a free-tier project that has auto-paused. Surface a
 * human-readable message instead of leaking `{}` into the auth form.
 */
export function authErrorMessage(error: AuthError): string {
  const message = error.message.trim();
  if (!message || message === "{}" || message === "[object Object]") {
    return FALLBACK_MESSAGE;
  }
  return message;
}
