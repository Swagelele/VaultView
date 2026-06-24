---
title: "Project Map — Artifact 3: Contributors"
created: 2026-06-23
type: repo-map-artifact
method: git shortlog / author + trailer analysis
---

# Contributors — who holds the knowledge

> Wide Scan, signal source 3 of 3. **Degenerate on this repo: solo project.**

## Authorship
- **100% of 80 commits:** `EMEA\jozk` (sole human author).
- ~38 commits co-authored by Claude (Opus 4.8 / 4.6) as a pairing agent — not an
  independent knowledge holder.

## Implication
The contributor lens exists to answer "who do I ask before touching this area?"
On a single-author repo that question has one answer everywhere: **you.** There is
no distributed or siloed tribal knowledge to map.

What replaces it here: the **`context/` system-of-record** is the real "who knows
this" — `context/archive/` holds the closed changes (with plans + research) that
document *why* each area looks the way it does. For VaultView, archived changes
are the ADR-equivalent to consult before a refactor (e.g. P&L math, RLS isolation).

## Note for when this stops being solo
If others join, re-run per-area authorship over a 6–12 month window, filter
bot/agent commits, and group by topic — that's where this artifact gains value.
