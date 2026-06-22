import { anonClient, type IntegrationClient } from "./clients";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
}

/**
 * Create a real, confirmed auth user and sign in to obtain a JWT, so tests run as a genuine
 * isolated principal. `email_confirm: true` skips the confirmation gate so `signInWithPassword`
 * works without the Mailpit flow. `index` disambiguates users created in the same millisecond.
 *
 * (`Date.now()` is fine here — it is only forbidden inside workflow scripts.)
 */
export async function createTestUser(svc: IntegrationClient, index = 0): Promise<TestUser> {
  // Random suffix keeps emails collision-safe regardless of Vitest's fileParallelism setting.
  const stamp = `${Date.now()}-${index}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `vault-it-${stamp}@example.test`;
  const password = `Pw-${stamp}-Aa1!`;

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) {
    throw new Error(`createTestUser: admin.createUser failed: ${createErr.message}`);
  }

  const { data: signedIn, error: signInErr } = await anonClient().auth.signInWithPassword({ email, password });
  if (signInErr) {
    throw new Error(`createTestUser: signInWithPassword failed: ${signInErr.message}`);
  }

  return { id: created.user.id, email, password, accessToken: signedIn.session.access_token };
}

/** Delete a test user; `ON DELETE CASCADE` removes all of their transactions. Idempotent enough for teardown. */
export async function deleteTestUser(svc: IntegrationClient, id: string): Promise<void> {
  const { error } = await svc.auth.admin.deleteUser(id);
  if (error) {
    // eslint-disable-next-line no-console -- surface teardown failures instead of leaking users silently
    console.warn(`deleteTestUser: failed to delete ${id}: ${error.message}`);
  }
}
