---
change_id: testing-persistence-data-isolation
title: Persistence and data isolation tests (Risks #3, #4)
status: implementing
created: 2026-06-18
updated: 2026-06-22
archived_at: null
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md` — integration layer.

Risks covered:

- **#3** — a transaction save reports success (HTTP 200) but persists wrong or partial state, leaving holdings inconsistent.
- **#4** — a user reads or mutates another user's transactions/positions (cross-user leak / IDOR, or an RLS gap).

Risk response intent (from test-plan §2):

- #3: prove that after a save the persisted rows match the operation, and a failed save does not return a success result. Do NOT test an imagined rollback that does not exist.
- #4: prove a request from user B for user A's resource is denied at the data boundary — ownership enforced, not just authentication; exercise the real RLS/ownership boundary, no over-mocking.

Test type: integration (local Supabase; needs a service-role client + a fresh account/session per test — no DB test harness exists yet).
