# VaultView Deployment Audit Trail

## Deployment Target

- **Platform**: Cloudflare Workers
- **Worker name**: `vault-view`
- **Production URL**: `https://vault-view.strozynskijoachim5.workers.dev`
- **GitHub repo**: `https://github.com/Swagelele/VaultView`
- **Production branch**: `master`

## Phase 0: Prerequisites -- Completed 2026-06-11

- Node.js 22.14.0 installed
- Cloudflare account created, Wrangler CLI authenticated
- Supabase cloud project created
- Local dev verified (dev server, auth flow, dashboard)

## Phase 1: Code Preparation -- Completed 2026-06-11

| Step | Change | Status |
|------|--------|--------|
| 1.1 | Renamed worker `10x-astro-starter` -> `vault-view` in `wrangler.jsonc` | Done |
| 1.2 | Renamed package + added `deploy`, `deploy:dry-run`, `deploy:preview` scripts | Done |
| 1.3 | Removed `@astrojs/sitemap` integration and uninstalled package | Done |
| 1.4 | Added `export const prerender = false` to 4 Astro pages + 3 API routes | Done |
| 1.5 | Created `.dev.vars.example` | Done |
| 1.6 | Verified: `astro sync` OK, `npm run build` OK, `wrangler deploy --dry-run` OK (391 KB gzipped) | Done |

## Phase 2: First Manual Deploy -- Completed 2026-06-11

- Worker deployed via `npm run deploy`
- KV namespace `vault-view-session` auto-provisioned for Astro sessions
- Secrets set via `wrangler secret put`: `SUPABASE_URL`, `SUPABASE_KEY`
- Verification: landing page loads, sign-in form renders and hydrates, auth flow works end-to-end

## Phase 3: Workers Builds (Auto-Deploy) -- Completed 2026-06-11

- GitHub repo migrated from `jozk_degi/VaultView` to `Swagelele/VaultView`
- Cloudflare Workers & Pages GitHub App installed on `Swagelele` account
- Workers Builds connected: build command `npm run build`, deploy command `npx wrangler deploy`, production branch `master`
- Verified: push to `master` triggers auto-build and deploy (~5 min)

## Phase 4: Documentation -- Completed 2026-06-12

- CLAUDE.md updated with deploy commands
- This audit trail created at `context/deployment/deploy-plan.md`

## Secrets Configuration

| Secret | Location | Set via |
|--------|----------|---------|
| `SUPABASE_URL` | Cloudflare Worker secrets | `npx wrangler secret put SUPABASE_URL` |
| `SUPABASE_KEY` | Cloudflare Worker secrets | `npx wrangler secret put SUPABASE_KEY` |

## Rollback

```bash
npx wrangler versions list          # see recent deployments
npx wrangler versions deploy <id>   # promote a previous version
```

Secrets are NOT versioned -- rolling back code does not roll back secrets.
