---
bootstrapped_at: 2026-05-29T16:15:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: vault-view
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: vault-view
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

### Why this stack

Solo-built crypto portfolio tracker (VaultView) with Google OAuth auth on a 5-week timeline targeting small scale. The recommended default for (web-app, js) is 10x Astro Starter — Astro 6 + React 19 + Supabase + Cloudflare — which ships auth, database, and edge deploy out of the box. It clears all four agent-friendly gates: TypeScript-first with Zod schemas at boundaries (typed), file-based routing with island architecture (convention-based), Astro + React are well-represented in training data (popular), and docs are current and versioned (well-documented). Cloudflare Pages is the deployment default; GitHub Actions with auto-deploy-on-merge is the CI shape. Standard path taken — no feature audit, team profile, or self-check needed for the vetted recommendation.

## Pre-scaffold verification

| Signal | Value | Severity | Notes |
| --- | --- | --- | --- |
| npm package | not run | — | cmd_template uses git clone, not an npm create CLI |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh | from card.docs_url |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 19
**Conflicts (.scaffold siblings)**: CLAUDE.md.scaffold
**.gitignore handling**: moved silently (no prior .gitignore in cwd)
**.bootstrap-scaffold/.git/ deleted**: yes (upstream starter history removed before move-up)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** v5.6.3–5.8.0 — GHSA-77vg-94rm-hx3p: DoS via sparse array deserialization (CVSS 7.5). Transitive dependency. Fix available via `npm audit fix`.

#### MODERATE findings

- **ws** v8.0.0–8.20.0 — GHSA-58qx-3vcg-4xpx: Uninitialized memory disclosure (CVSS 4.4). Transitive via @supabase/realtime-js. Fix available.
- **yaml** v2.0.0–2.8.2 — GHSA-48c2-rrv3-qjmp: Stack overflow via deeply nested YAML collections (CVSS 4.3). Transitive via yaml-language-server. Fix available (requires @astrojs/check major downgrade).
- **wrangler** v3.108.0–4.93.0 — Affected via miniflare → ws. Direct dependency. Fix available.
- **miniflare** v3.20250204.0–4.20260518.0 — Affected via ws. Transitive. Fix available.
- **@cloudflare/vite-plugin** — Affected via miniflare, wrangler, ws. Transitive. Fix available.
- **@astrojs/check** >=0.9.3 — Affected via @astrojs/language-server → volar-service-yaml → yaml-language-server → yaml. Direct dependency. Fix requires major version downgrade to 0.9.2.
- **@astrojs/language-server** >=2.14.0 — Affected via volar-service-yaml. Transitive.
- **volar-service-yaml** <=0.0.70 — Affected via yaml-language-server. Transitive.
- **yaml-language-server** — Affected via yaml. Transitive.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint | Value |
| --- | --- |
| bootstrapper_confidence | first-class |
| quality_override | false |
| path_taken | standard |
| self_check_answers | null |
| team_size | solo |
| deployment_target | cloudflare-pages |
| ci_provider | github-actions |
| ci_default_flow | auto-deploy-on-merge |
| has_auth | true |
| has_payments | false |
| has_realtime | false |
| has_ai | false |
| has_background_jobs | false |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
