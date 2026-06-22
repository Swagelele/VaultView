import { serviceClient } from "./clients";

/**
 * Probe the local Supabase stack once at module load. A cheap service-role read either succeeds
 * (DB up) or returns/throws an error (DB down — e.g. Docker stopped → connection refused). The
 * result is a module-singleton consumed by every integration suite via `describe.skipIf(!dbAvailable)`.
 */
async function probe(): Promise<boolean> {
  try {
    const { error } = await serviceClient().from("transactions").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export const dbAvailable = await probe();
