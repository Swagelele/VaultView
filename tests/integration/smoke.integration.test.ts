import { describe, it, expect } from "vitest";
import { serviceClient } from "./clients";
import { seedTransaction, selectTransactions } from "./transactions";
import { createTestUser, deleteTestUser } from "./users";
import { dbAvailable } from "./db";

// Proves the harness end-to-end: create a real user, insert a row for them, read it back, then
// delete the user and confirm the row is gone via ON DELETE CASCADE. If this passes, the two risk
// suites stand on a trusted foundation.
describe.skipIf(!dbAvailable)("integration harness smoke", () => {
  it("creates a user, inserts a row, reads it back, and cascade-deletes on user removal", async () => {
    const svc = serviceClient();
    const user = await createTestUser(svc);
    let deleted = false;

    try {
      const inserted = await seedTransaction(svc, {
        user_id: user.id,
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 100,
        target_asset: null,
        target_quantity: null,
        price: 1,
        price_usd: 1,
        fee: 0,
        location: "Smoke",
        transaction_date: "2026-01-01T00:00:00Z",
      });
      expect(inserted.id).not.toBe("");

      const readBack = await selectTransactions(svc, { id: inserted.id });
      expect(readBack).toHaveLength(1);
      expect(readBack[0].user_id).toBe(user.id);
      expect(readBack[0].source_quantity).toBe(100);

      await deleteTestUser(svc, user.id);
      deleted = true;

      const afterDelete = await selectTransactions(svc, { id: inserted.id });
      expect(afterDelete).toEqual([]);
    } finally {
      if (!deleted) {
        await deleteTestUser(svc, user.id);
      }
    }
  });
});
