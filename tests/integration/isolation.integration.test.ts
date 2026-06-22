import { describe, it, expect, afterEach } from "vitest";
import { serviceClient, userClient, type TransactionInsert } from "./clients";
import { createTestUser, deleteTestUser, type TestUser } from "./users";
import { seedTransaction, selectTransactions } from "./transactions";
import { dbAvailable } from "./db";

// Risk #4 — a user reads or mutates another user's rows. The denial assertions go through user B's
// RLS-scoped client (a real JWT, so `auth.uid()` resolves), NEVER the service-role client (which
// bypasses RLS and would defeat the test). The service-role client is used only to seed user A's
// rows and to read ground truth.
const svc = serviceClient();
const createdUserIds: string[] = [];

async function newUser(): Promise<TestUser> {
  const user = await createTestUser(svc, createdUserIds.length);
  createdUserIds.push(user.id);
  return user;
}

/** A minimal valid row for `userId` at `location`. */
function depositRow(userId: string, location: string): TransactionInsert {
  return {
    user_id: userId,
    type: "DEPOSIT",
    source_asset: "btc-bitcoin",
    source_quantity: 1,
    target_asset: null,
    target_quantity: null,
    price: 50000,
    price_usd: 50000,
    fee: 0,
    location,
    transaction_date: "2026-01-01T00:00:00Z",
  };
}

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    if (id) {
      await deleteTestUser(svc, id);
    }
  }
});

describe.skipIf(!dbAvailable)("data isolation (Risk #4)", () => {
  it("denies a cross-user read: user B sees none of user A's rows through the RLS boundary", async () => {
    const userA = await newUser();
    const userB = await newUser();
    await seedTransaction(svc, depositRow(userA.id, "A-Binance"));

    const bClient = userClient(userB.accessToken);
    // B's own collection is empty...
    expect(await selectTransactions(bClient, {})).toEqual([]);
    // ...and even explicitly filtering by A's user_id returns nothing — RLS scopes to auth.uid() = B.
    expect(await selectTransactions(bClient, { userId: userA.id })).toEqual([]);

    // Ground truth (service-role bypasses RLS): A's row really exists.
    expect(await selectTransactions(svc, { userId: userA.id })).toHaveLength(1);
  });

  it("denies a cross-user write: user B cannot insert a row owned by user A", async () => {
    const userA = await newUser();
    const userB = await newUser();
    const bClient = userClient(userB.accessToken);

    // B tries to forge a row owned by A — RLS WITH CHECK (auth.uid() = user_id) must reject it.
    const forged = await bClient.from("transactions").insert(depositRow(userA.id, "Hijack")).select();
    expect(forged.error).not.toBeNull();

    // Nothing landed for A (confirmed via service-role).
    expect(await selectTransactions(svc, { userId: userA.id, location: "Hijack" })).toEqual([]);

    // B CAN write its own row — proves the denial is ownership-based, not a blanket insert block.
    const own = await bClient.from("transactions").insert(depositRow(userB.id, "B-Own")).select();
    expect(own.error).toBeNull();
  });

  it("positive control: user A reads exactly its own rows and can self-insert", async () => {
    const userA = await newUser();
    await seedTransaction(svc, depositRow(userA.id, "A-Binance"));
    await seedTransaction(svc, depositRow(userA.id, "A-Metamask"));

    const aClient = userClient(userA.accessToken);
    const visible = await selectTransactions(aClient, {});
    expect(visible).toHaveLength(2);
    expect(visible.every((r) => r.user_id === userA.id)).toBe(true);

    // A's own insert succeeds...
    const own = await aClient.from("transactions").insert(depositRow(userA.id, "A-Self")).select();
    expect(own.error).toBeNull();
    // ...and is now visible to A.
    expect(await selectTransactions(aClient, {})).toHaveLength(3);
  });
});
