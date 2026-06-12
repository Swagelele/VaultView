---
project: "VaultView"
source: context/foundation/roadmap.md (v1)
github_repo: Swagelele/VaultView
linear_project: https://linear.app/vault-view/project/vaultview-cbc1449facb1
synced_at: 2026-06-12
issues_total: 15
---

# GitHub Issues — VaultView

> Mirror of `context/foundation/roadmap.md` tracked in [GitHub Issues](https://github.com/Swagelele/VaultView/issues) and [Linear (project VaultView)](https://linear.app/vault-view/project/vaultview-cbc1449facb1).
> Each issue exists in both systems with crosslinks. This file is the local index.

## At a glance

| # | ID | Title | Labels | Status | Blocked by | Linear |
|---|-----|-------|--------|--------|------------|--------|
| [#1](https://github.com/Swagelele/VaultView/issues/1) | F-01 | Google OAuth auth | `foundation` `ready` | open | — | [PAX-5](https://linear.app/vault-view/issue/PAX-5) |
| [#2](https://github.com/Swagelele/VaultView/issues/2) | F-02 | Transaction schema + RLS | `foundation` `ready` | open | — | [PAX-6](https://linear.app/vault-view/issue/PAX-6) |
| [#3](https://github.com/Swagelele/VaultView/issues/3) | S-01 | Trade (BUY/SELL/SWAP) + portfolio with P&L | `slice` `north-star` `proposed` | open | #1, #2 | [PAX-7](https://linear.app/vault-view/issue/PAX-7) |
| [#4](https://github.com/Swagelele/VaultView/issues/4) | S-02 | Per-buy P&L breakdown | `slice` `proposed` | open | #3 | [PAX-8](https://linear.app/vault-view/issue/PAX-8) |
| [#5](https://github.com/Swagelele/VaultView/issues/5) | S-03 | Summary dashboard | `slice` `proposed` | open | #3 | [PAX-9](https://linear.app/vault-view/issue/PAX-9) |
| [#6](https://github.com/Swagelele/VaultView/issues/6) | S-04 | Transaction list with filters | `slice` `proposed` | open | #3 | [PAX-10](https://linear.app/vault-view/issue/PAX-10) |
| [#7](https://github.com/Swagelele/VaultView/issues/7) | S-05 | Deposit with historical cost basis | `slice` `proposed` | open | #3 | [PAX-11](https://linear.app/vault-view/issue/PAX-11) |
| [#8](https://github.com/Swagelele/VaultView/issues/8) | S-06 | Withdraw (cash-out with realized P&L) | `slice` `proposed` | open | #3 | [PAX-12](https://linear.app/vault-view/issue/PAX-12) |
| [#9](https://github.com/Swagelele/VaultView/issues/9) | S-07 | Sell-all at single location | `slice` `proposed` | open | #3 | [PAX-13](https://linear.app/vault-view/issue/PAX-13) |
| [#10](https://github.com/Swagelele/VaultView/issues/10) | S-08 | Global sell-all (all locations) | `slice` `proposed` | open | #9 | [PAX-14](https://linear.app/vault-view/issue/PAX-14) |
| [#11](https://github.com/Swagelele/VaultView/issues/11) | Q-01 | Decide WITHDRAW pricing mechanism | `question` | open | — | [PAX-15](https://linear.app/vault-view/issue/PAX-15) |
| [#12](https://github.com/Swagelele/VaultView/issues/12) | Q-02 | Decide Google OAuth provider config | `question` | open | — | [PAX-16](https://linear.app/vault-view/issue/PAX-16) |
| [#13](https://github.com/Swagelele/VaultView/issues/13) | R-01 | Spike: CoinPaprika API endpoints verification | `research` | open | — | [PAX-17](https://linear.app/vault-view/issue/PAX-17) |
| [#14](https://github.com/Swagelele/VaultView/issues/14) | R-02 | Spike: Average Cost P&L engine rules + test cases | `research` | open | — | [PAX-18](https://linear.app/vault-view/issue/PAX-18) |
| [#15](https://github.com/Swagelele/VaultView/issues/15) | R-03 | Spike: Supabase Google OAuth on Cloudflare Workers | `research` | open | — | [PAX-19](https://linear.app/vault-view/issue/PAX-19) |

## Dependency graph

```
R-03 (#15) ──┐
Q-02 (#12) ──┤
             ▼
F-01 (#1) ───┐
             ├──► S-01 (#3) ⭐ ──┬──► S-02 (#4)
F-02 (#2) ───┘                   ├──► S-03 (#5)
                                 ├──► S-04 (#6)
R-01 (#13) ──► S-01 (#3)        ├──► S-05 (#7)
R-02 (#14) ──► S-01 (#3)        ├──► S-06 (#8) ◄── Q-01 (#11)
                                 └──► S-07 (#9) ──► S-08 (#10)
```

## Streams

| Stream | Theme | Issues | Note |
|--------|-------|--------|------|
| A | Core trade | #1, #2 → #3 | North star; everything depends on S-01 |
| B | Portfolio views | #4, #5, #6 | Parallel after S-01 |
| C | Additional operations | #7, #8 | DEPOSIT + WITHDRAW after S-01 |
| D | Sell-all | #9 → #10 | Single-location then global |

## Labels

| Label | Color | Meaning |
|-------|-------|---------|
| `foundation` | grey | Cross-cutting prerequisite (F-NN) |
| `slice` | blue | Vertical user-visible slice (S-NN) |
| `north-star` | yellow | Validation milestone |
| `question` | orange | Decision needed before implementation |
| `research` | green | Spike / investigation needed |
| `ready` | green | Prerequisites met, ready for `/10x-plan` |
| `proposed` | light grey | Sequenced but prerequisites not yet met |

## How to use

- **Start planning:** pick a `ready` issue (currently #1 and #2) and run `/10x-plan <change-id>`
- **After completing a foundation:** close its GitHub issue, flip its Linear status to Done, and update downstream issues from `proposed` to `ready`
- **Questions / Research:** resolve Q/R issues before the roadmap items they block; document findings in the issue thread
- **Sync:** this file is a snapshot; GitHub and Linear are the live sources of truth
