---
change_id: transaction-schema-rls
title: Transaction schema and RLS policies for multi-user data isolation
status: planned
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

F-02 from roadmap.md — foundation that unlocks all vertical slices. Creates the `transactions` table in Supabase with fields for two-sided trades (BUY/SELL/SWAP) and one-sided operations (DEPOSIT/WITHDRAW). RLS policies enforce per-user data isolation (NFR: no user sees another user's data).
