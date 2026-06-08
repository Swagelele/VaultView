---
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
---

## Why this stack

Solo-built crypto portfolio tracker (VaultView) with Google OAuth auth on a 5-week timeline targeting small scale. The recommended default for (web-app, js) is 10x Astro Starter — Astro 6 + React 19 + Supabase + Cloudflare — which ships auth, database, and edge deploy out of the box. It clears all four agent-friendly gates: TypeScript-first with Zod schemas at boundaries (typed), file-based routing with island architecture (convention-based), Astro + React are well-represented in training data (popular), and docs are current and versioned (well-documented). Cloudflare Pages is the deployment default; GitHub Actions with auto-deploy-on-merge is the CI shape. Standard path taken — no feature audit, team profile, or self-check needed for the vetted recommendation.
