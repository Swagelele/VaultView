import process from "node:process";

/**
 * Local Supabase connection config for integration tests.
 *
 * The defaults below are the PUBLIC, non-secret demo JWTs that `npx supabase start` prints for
 * the standard local stack — they are safe to commit and identical on every machine running the
 * default stack. Override any value via environment variables for a customized stack:
 *
 *   npx supabase status -o env
 *
 * Resolution precedence: explicit env var → committed local default.
 * (We intentionally do NOT import `@/lib/supabase.ts` or `astro:env` here — those throw outside
 * the Cloudflare workerd runtime. Integration clients are built directly from @supabase/supabase-js.)
 */

const DEFAULT_URL = "http://127.0.0.1:54321";

const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const DEFAULT_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export const url = process.env.SUPABASE_URL ?? DEFAULT_URL;
export const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_KEY ?? DEFAULT_ANON_KEY;
export const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;
