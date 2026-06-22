import { dbAvailable } from "./db";

// Surface a single, actionable hint when the local stack is down, so a contributor without
// Docker/Supabase running sees why the integration suite skipped (rather than a wall of red).
// Suites themselves guard with `describe.skipIf(!dbAvailable)`.
if (!dbAvailable) {
  // eslint-disable-next-line no-console -- intentional operator hint for the local-only integration suite
  console.warn("local Supabase not reachable — run `npx supabase start`; skipping integration tests");
}
