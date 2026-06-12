---
project: "VaultView"
source: context/foundation/roadmap.md (v1)
linear_workspace: vault-view
linear_project: https://linear.app/vault-view/project/vaultview-cbc1449facb1
linear_team: Pax (PAX)
github_repo: Swagelele/VaultView
synced_at: 2026-06-12
issues_total: 15
---

# Linear Issues — VaultView

> Mirror of `context/foundation/roadmap.md` tracked in [Linear project VaultView](https://linear.app/vault-view/project/vaultview-cbc1449facb1) and [GitHub Issues](https://github.com/Swagelele/VaultView/issues).
> Each issue exists in both systems with crosslinks. This file is the local index for Linear.

## Linear setup

- **Workspace:** vault-view
- **Team:** Pax (key: `PAX`)
- **Project:** VaultView (priority: High, target: 2026-07-05, lead: Joachim Strożyński)
- **MCP access:** `linear-server` configured in `.claude.json` (`https://mcp.linear.app/mcp`)

### Statuses used

| Status | Type | Used for |
|--------|------|----------|
| **Todo** | unstarted | Foundations ready to start (F-01, F-02) |
| **Backlog** | backlog | Slices waiting on prerequisites; Q/R items |
| **In Progress** | started | Active work |
| **In Review** | started | PR open, awaiting review |
| **Done** | completed | Delivered and verified |

### Labels created for this project

| Label | Color | Meaning |
|-------|-------|---------|
| `Foundation` | #95A2B3 (grey) | Cross-cutting prerequisite (F-NN) |
| `Slice` | #26B5CE (blue) | Vertical user-visible slice (S-NN) |
| `North Star` | #F2C94C (yellow) | Validation milestone — S-01 |
| `Question` | #F2994A (orange) | Decision needed before implementation |
| `Research` | #6FCF97 (green) | Spike / investigation needed |

## At a glance

| Linear ID | Roadmap | Title | Labels | Priority | Status | Blocked by | GitHub |
|-----------|---------|-------|--------|----------|--------|------------|--------|
| [PAX-5](https://linear.app/vault-view/issue/PAX-5) | F-01 | Google OAuth auth | Foundation | High | Todo | — | [#1](https://github.com/Swagelele/VaultView/issues/1) |
| [PAX-6](https://linear.app/vault-view/issue/PAX-6) | F-02 | Transaction schema + RLS | Foundation | High | Todo | — | [#2](https://github.com/Swagelele/VaultView/issues/2) |
| [PAX-7](https://linear.app/vault-view/issue/PAX-7) | S-01 | Trade (BUY/SELL/SWAP) + portfolio with P&L | Slice, North Star | Urgent | Backlog | PAX-5, PAX-6 | [#3](https://github.com/Swagelele/VaultView/issues/3) |
| [PAX-8](https://linear.app/vault-view/issue/PAX-8) | S-02 | Per-buy P&L breakdown | Slice | Medium | Backlog | PAX-7 | [#4](https://github.com/Swagelele/VaultView/issues/4) |
| [PAX-9](https://linear.app/vault-view/issue/PAX-9) | S-03 | Summary dashboard | Slice | Medium | Backlog | PAX-7 | [#5](https://github.com/Swagelele/VaultView/issues/5) |
| [PAX-10](https://linear.app/vault-view/issue/PAX-10) | S-04 | Transaction list with filters | Slice | Medium | Backlog | PAX-7 | [#6](https://github.com/Swagelele/VaultView/issues/6) |
| [PAX-11](https://linear.app/vault-view/issue/PAX-11) | S-05 | Deposit with historical cost basis | Slice | Medium | Backlog | PAX-7 | [#7](https://github.com/Swagelele/VaultView/issues/7) |
| [PAX-12](https://linear.app/vault-view/issue/PAX-12) | S-06 | Withdraw (cash-out with realized P&L) | Slice | Medium | Backlog | PAX-7 | [#8](https://github.com/Swagelele/VaultView/issues/8) |
| [PAX-13](https://linear.app/vault-view/issue/PAX-13) | S-07 | Sell-all at single location | Slice | Medium | Backlog | PAX-7 | [#9](https://github.com/Swagelele/VaultView/issues/9) |
| [PAX-14](https://linear.app/vault-view/issue/PAX-14) | S-08 | Global sell-all (all locations) | Slice | Low | Backlog | PAX-13 | [#10](https://github.com/Swagelele/VaultView/issues/10) |
| [PAX-15](https://linear.app/vault-view/issue/PAX-15) | Q-01 | Decide WITHDRAW pricing mechanism | Question | Medium | Backlog | blocks PAX-12 | [#11](https://github.com/Swagelele/VaultView/issues/11) |
| [PAX-16](https://linear.app/vault-view/issue/PAX-16) | Q-02 | Decide Google OAuth provider config | Question | High | Backlog | blocks PAX-5 | [#12](https://github.com/Swagelele/VaultView/issues/12) |
| [PAX-17](https://linear.app/vault-view/issue/PAX-17) | R-01 | Spike: CoinPaprika API endpoints verification | Research | High | Backlog | blocks PAX-7 | [#13](https://github.com/Swagelele/VaultView/issues/13) |
| [PAX-18](https://linear.app/vault-view/issue/PAX-18) | R-02 | Spike: Average Cost P&L engine rules + test cases | Research | High | Backlog | blocks PAX-7 | [#14](https://github.com/Swagelele/VaultView/issues/14) |
| [PAX-19](https://linear.app/vault-view/issue/PAX-19) | R-03 | Spike: Supabase Google OAuth on Cloudflare Workers | Research | High | Backlog | blocks PAX-5 | [#15](https://github.com/Swagelele/VaultView/issues/15) |

## Dependency graph

```
R-03 (PAX-19) ──┐
Q-02 (PAX-16) ──┤
                ▼
F-01 (PAX-5) ───┐
                ├──► S-01 (PAX-7) ⭐ ──┬──► S-02 (PAX-8)
F-02 (PAX-6) ───┘                      ├──► S-03 (PAX-9)
                                        ├──► S-04 (PAX-10)
R-01 (PAX-17) ──► S-01 (PAX-7)         ├──► S-05 (PAX-11)
R-02 (PAX-18) ──► S-01 (PAX-7)         ├──► S-06 (PAX-12) ◄── Q-01 (PAX-15)
                                        └──► S-07 (PAX-13) ──► S-08 (PAX-14)
```

## Blocking relations (native Linear)

Linear uses native `blockedBy` / `blocks` relations. These are enforced in the UI — a blocked issue shows its blockers inline.

| Issue | blockedBy | blocks |
|-------|-----------|--------|
| PAX-5 (F-01) | — | PAX-7 |
| PAX-6 (F-02) | — | PAX-7 |
| PAX-7 (S-01) | PAX-5, PAX-6 | PAX-8, PAX-9, PAX-10, PAX-11, PAX-12, PAX-13 |
| PAX-8 (S-02) | PAX-7 | — |
| PAX-9 (S-03) | PAX-7 | — |
| PAX-10 (S-04) | PAX-7 | — |
| PAX-11 (S-05) | PAX-7 | — |
| PAX-12 (S-06) | PAX-7 | — |
| PAX-13 (S-07) | PAX-7 | PAX-14 |
| PAX-14 (S-08) | PAX-13 | — |
| PAX-15 (Q-01) | — | PAX-12 |
| PAX-16 (Q-02) | — | PAX-5 |
| PAX-17 (R-01) | — | PAX-7 |
| PAX-18 (R-02) | — | PAX-7 |
| PAX-19 (R-03) | — | PAX-5 |

## Streams

| Stream | Theme | Linear issues | Note |
|--------|-------|---------------|------|
| A | Core trade | PAX-5, PAX-6 → PAX-7 | North star; everything depends on S-01 |
| B | Portfolio views | PAX-8, PAX-9, PAX-10 | Parallel after S-01 |
| C | Additional operations | PAX-11, PAX-12 | DEPOSIT + WITHDRAW after S-01 |
| D | Sell-all | PAX-13 → PAX-14 | Single-location then global |

## Git branch names (auto-generated by Linear)

| Issue | Branch |
|-------|--------|
| PAX-5 | `strozynskijoachim5/pax-5-f-01-google-oauth-auth` |
| PAX-6 | `strozynskijoachim5/pax-6-f-02-transaction-schema-rls` |
| PAX-7 | `strozynskijoachim5/pax-7-s-01-trade-buysellswap-portfolio-with-pl` |
| PAX-8 | `strozynskijoachim5/pax-8-s-02-per-buy-pl-breakdown` |
| PAX-9 | `strozynskijoachim5/pax-9-s-03-summary-dashboard` |
| PAX-10 | `strozynskijoachim5/pax-10-s-04-transaction-list-with-filters` |
| PAX-11 | `strozynskijoachim5/pax-11-s-05-deposit-with-historical-cost-basis` |
| PAX-12 | `strozynskijoachim5/pax-12-s-06-withdraw-cash-out-with-realized-pl` |
| PAX-13 | `strozynskijoachim5/pax-13-s-07-sell-all-at-single-location` |
| PAX-14 | `strozynskijoachim5/pax-14-s-08-global-sell-all-all-locations` |

## How to use

- **Start planning:** pick a `Todo` issue (currently PAX-5 and PAX-6) and run `/10x-plan <change-id>`
- **Move to In Progress:** when starting work, update status in Linear (auto-syncs to the board)
- **Use Linear branches:** checkout the auto-generated branch name; Linear links PRs to issues automatically
- **After completing a foundation:** flip to Done in Linear, close the GitHub issue, and move downstream slices from Backlog to Todo
- **Questions / Research:** resolve Q/R issues before the roadmap items they block; document findings in the issue comments
- **Sync:** this file is a snapshot; Linear and GitHub are the live sources of truth
