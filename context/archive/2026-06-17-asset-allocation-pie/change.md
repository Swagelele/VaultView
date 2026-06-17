---
change_id: asset-allocation-pie
title: Asset allocation pie/donut chart
status: archived
created: 2026-06-17
updated: 2026-06-17
archived_at: 2026-06-17T11:16:22Z
---

## Notes

Roadmap S-09 (FR-014). User sees portfolio allocation as a pie/donut chart — each asset's share of total current portfolio value. Current-state snapshot (no time dimension), computed from holdings × current price. All inputs already exist in the `/api/portfolio` response from S-01; additive UI, no data-model change. Open decision: charting library (e.g. recharts) vs. lightweight hand-rolled SVG — to resolve in `/10x-plan`.
