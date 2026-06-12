---
project: vault-view
researched_at: 2026-06-08
recommended_platform: Cloudflare Workers + Pages
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

Cloudflare is the native deployment target for this stack — the project already ships with `@astrojs/cloudflare` v13.5.0, a configured `wrangler.jsonc`, and `astro:env/server` environment variable patterns that only work on Cloudflare. After Cloudflare's acquisition of Astro in January 2026, the integration is first-class: `astro dev` runs on the workerd runtime locally, `npx wrangler deploy` ships to production, and the free tier covers 100,000 requests per day — more than enough for an MVP crypto tracker. Durable Objects provide WebSocket support for real-time price updates without external relay services. The developer interview confirmed no strong platform familiarity and single-region reach, which neutralized the main advantages competing platforms would have over Cloudflare. The persistent-connections requirement (Q1) dropped Vercel and Netlify from consideration.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Total | Status |
|---|---|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass | Pass | Partial | 4.5/5 | Evaluated |
| **Railway** | Pass | Pass | Pass | Pass | Pass | 5.0/5 | Evaluated |
| **Fly.io** | Pass | Partial | Partial | Partial | Pass | 3.5/5 | Evaluated |
| **Render** | Partial | Pass | Fail | Partial | Pass | 3.0/5 | Evaluated |
| **Vercel** | — | — | — | — | — | — | Dropped (no WebSocket) |
| **Netlify** | — | — | — | — | — | — | Dropped (no WebSocket) |

### Scoring Notes

**CLI-first**: Cloudflare (`wrangler`), Railway (`railway`), and Fly.io (`flyctl`) all offer comprehensive CLI tooling. Render's CLI exists but rollbacks require the dashboard.

**Managed/Serverless**: Cloudflare and Railway are fully managed with zero Dockerfile requirement. Fly.io requires a Dockerfile and manages VMs — more operational surface. Render is managed but free-tier instances spin down after 15 minutes of inactivity.

**Agent-readable docs**: Cloudflare publishes per-product `llms.txt` files and supports markdown content negotiation via `Accept: text/markdown`. Railway publishes `llms.txt` at `railway.com/llms.txt`. Fly.io has GitHub-hosted MDX docs but no `llms.txt`. Render's docs are HTML-only with no agent-friendly export.

**Stable deploy API**: Cloudflare's `wrangler deploy` and Railway's `railway up` are both deterministic one-command deploys. Fly.io lacks a native rollback command (requires manual `fly deploy -i <image-hash>`). Render's rollback is dashboard-dependent.

**MCP/Integration**: Railway launched a Remote MCP Server (GA April 2026) and `railway agent` CLI command. Fly.io provides native MCP via `fly mcp server` with Claude Desktop integration. Render's MCP Server has been GA since August 2025 with 20+ actions. Cloudflare's MCP story is fragmented — wrangler CLI is the primary agent path, with no single consolidated MCP server confirmed by research.

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

The project is already built for Cloudflare: `@astrojs/cloudflare` adapter configured, `wrangler.jsonc` in place, env vars declared via `astro:env/server`, and `nodejs_compat` flag enabled. Zero adapter migration needed. The free tier (100k requests/day, 10M requests/month on paid at $5/mo) is the most generous of any candidate. Durable Objects (GA) handle WebSocket connections with hibernation for cost optimization. Post-Astro-acquisition, Cloudflare is the strategic home for the framework — `astro dev` already runs on workerd locally, providing full runtime fidelity during development.

#### 2. Railway

Highest raw criteria score (5/5) with excellent developer experience: `railway up` auto-detects Astro, `llms.txt` published, and MCP integration is GA. The gap vs. Cloudflare: a **permanent 15-minute WebSocket timeout** that requires client-side reconnection logic for real-time features, $5/month minimum cost (no free tier), and — critically — switching from Cloudflare requires replacing the adapter with `@astrojs/node`, rewriting `astro:env/server` to `process.env`, and removing all `wrangler.jsonc` configuration.

#### 3. Fly.io

Best raw WebSocket support — full persistent connections with no timeout, running on real VMs. MCP integration via `flyctl` is strong. The gaps: requires a Dockerfile (more ops surface for a solo developer), no free tier (minimum ~$2/month), no `llms.txt`, and rollback requires manual image hash lookup. Also requires adapter swap to `@astrojs/node`.

## Anti-Bias Cross-Check: Cloudflare

### Devil's Advocate — Weaknesses

1. **Durable Objects complexity for WebSockets.** The Durable Objects programming model (hibernation API, per-object state, billing) is a distinct paradigm from Node.js WebSocket servers. Learning and debugging it on a 5-week solo timeline is a real risk.
2. **workerd is not Node.js.** Any npm package relying on Node built-ins (`fs`, `path`, `crypto`, `net`) fails at runtime — not at build time. This extends to transitive dependencies in the Supabase client chain, where a minor patch could pull in an incompatible import.
3. **Hybrid SSR bug in Astro 6.** A known issue requires explicit `export const prerender = false` on dynamic pages. Forgetting this on a new page serves stale static content — dangerous for a portfolio tracker showing live positions.
4. **Bundle size ceiling.** A full Astro 6 + React 19 SSR app with Supabase, Tailwind 4, and shadcn components could approach the Worker script startup CPU limit, especially with island hydration scripts.
5. **Rollback friction.** While `wrangler versions` exists, the rollback workflow is less intuitive than Railway's `railway redeploy`. In a production incident on a solo project, this friction costs time.

### Pre-Mortem — How This Could Fail

Six months after launching VaultView on Cloudflare Workers, the project is in trouble. The Durable Objects WebSocket implementation consumed three of the five sprint weeks — the hibernation API documentation was thin, and debugging connection state across hibernation cycles ate days of the timeline. The free tier held initially, but once Durable Objects storage billing kicked in, costs climbed unpredictably because each WebSocket connection creates a persistent Durable Object instance. The `@supabase/ssr` library worked at launch, but a minor patch pulled in a transitive dependency using Node's `crypto.subtle` in a pattern workerd doesn't support — the app crashed in production with no local reproduction because `wrangler dev` uses a slightly different runtime path. The Astro 6 hybrid SSR workaround was forgotten on two new pages, causing them to serve stale portfolio data. By month four, the developer considered migrating to Railway for a normal Node.js runtime — but the Cloudflare-specific Durable Objects code, `astro:env/server` patterns, and wrangler configuration represented weeks of platform-coupled work that couldn't transfer.

### Unknown Unknowns

- **Durable Object cold starts at low traffic.** A personal tracker with a handful of users sees Durable Object instances evicted frequently, causing latency spikes when WebSocket connections re-establish — the exact scenario where sub-second responsiveness matters most.
- **`astro:env/server` coupling.** Astro 6 on Cloudflare uses its own env schema in `astro.config.mjs`, not `process.env`. Every third-party library or helper that reads `process.env` must be adapted. This coupling only surfaces when integrating new dependencies.
- **Preview deploys are public by default.** Cloudflare Pages preview deployments are accessible to anyone with the URL. For a financial tracker showing portfolio positions, this is a security gap unless Cloudflare Access (free for 50 users) is explicitly configured.
- **wrangler dev fidelity gaps.** While `wrangler dev` runs workerd locally, some Durable Objects, D1, and KV behaviors differ from production. Tests that pass locally can fail in production with no staging environment unless explicitly configured.
- **Vendor lock-in depth.** The combination of `@astrojs/cloudflare` + Durable Objects + `astro:env/server` creates deep platform coupling. Migration cost grows with every Cloudflare-specific API consumed.

## Operational Story

- **Preview deploys**: Every push to a non-production branch on a connected GitHub repo creates a preview URL at `<commit-hash>.<project>.pages.dev`. Preview URLs are public by default — configure Cloudflare Access (free, up to 50 users) to restrict access for a financial app. Fork PRs do not trigger preview builds unless explicitly allowed.
- **Secrets**: Environment variables are set via `npx wrangler secret put <KEY>` (encrypted at rest, scoped to the Worker). For CI, store `SUPABASE_URL` and `SUPABASE_KEY` as GitHub Actions repository secrets and pass them at build time. The `astro:env/server` schema in `astro.config.mjs` declares which env vars exist — but their values come from Cloudflare's secret store at runtime, not from `.env` files.
- **Rollback**: Run `npx wrangler versions list` to see deployment history, then `npx wrangler versions deploy <version-id>` to promote a previous version. Typical time-to-revert: under 30 seconds globally. Caveat: database migrations (Supabase) do not roll back automatically — plan migration rollback scripts separately.
- **Approval**: Human-only actions: publish to production for the first time, rotate Supabase keys, delete the Worker project, change billing plan. Agent-safe actions: deploy new versions, tail logs, read deployment status, upload preview builds.
- **Logs**: Tail runtime logs with `npx wrangler tail` (streams live Worker invocation logs). Build logs are visible in the Cloudflare dashboard or via GitHub Actions CI output. The `observability.enabled: true` flag in `wrangler.jsonc` is already configured, enabling Workers Logpush for persistent log storage if needed.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Durable Objects complexity delays WebSocket feature beyond sprint timeline | Devil's advocate | Medium | High | Defer Durable Objects to post-MVP. Use client-side polling (setInterval + fetch every 15-30s) for price refresh — the PRD's refresh pattern works without WebSockets. Add Durable Objects in a later sprint when timeline pressure is off. |
| workerd runtime breaks a transitive Supabase dependency | Devil's advocate | Medium | High | Pin `@supabase/ssr` and `@supabase/supabase-js` to exact versions in `package.json`. Test every dependency update in a preview deploy before merging. The `nodejs_compat` flag is already enabled in `wrangler.jsonc`. |
| Forgotten `prerender = false` serves stale portfolio data | Devil's advocate | Medium | Medium | Add a lint rule or code review checklist item: every page under `/dashboard` and `/api` must have `export const prerender = false`. Consider making SSR the default and opting static pages in explicitly. |
| Bundle size hits Worker CPU startup limit | Devil's advocate | Low | High | Monitor bundle size during CI (`wrangler deploy --dry-run` reports size). Tree-shake aggressively. If hit, split heavy React islands into lazy-loaded chunks. |
| Durable Object cold starts cause latency spikes for low-traffic users | Unknown unknowns | Medium | Medium | WebSocket Hibernation API (GA) reduces eviction. For MVP, client-side polling avoids this entirely. |
| Preview deploys expose portfolio data publicly | Unknown unknowns | Medium | High | Configure Cloudflare Access on the `*.pages.dev` subdomain before first preview deploy. Free tier supports up to 50 users. |
| wrangler dev behavior diverges from production | Unknown unknowns | Medium | Medium | Deploy to a staging Worker (`wrangler deploy --env staging`) for integration testing. Don't rely solely on local dev for Durable Objects or KV behavior. |
| Vendor lock-in makes future platform migration expensive | Unknown unknowns | Low | Medium | Accepted for MVP. Keep business logic in `src/lib/` decoupled from Cloudflare APIs. If migration becomes necessary, the adapter swap to `@astrojs/node` is the main effort — Supabase is already external. |
| Cloudflare pricing changes after Astro acquisition period | Pre-mortem | Low | Medium | The free tier is well-established (100k req/day). Monitor Cloudflare's developer platform announcements. At MVP scale, even the $5/month paid tier is manageable. |

## Getting Started

1. **Install wrangler globally** (optional — the project already has it as a devDependency at v4.90.0):
   ```bash
   npm install -g wrangler
   ```

2. **Authenticate with Cloudflare**:
   ```bash
   npx wrangler login
   ```
   This opens a browser for OAuth. The resulting API token is stored locally at `~/.wrangler/config/default.toml`.

3. **Set production secrets** (Supabase credentials):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
   Enter the values when prompted. These are encrypted and scoped to the Worker.

4. **Deploy**:
   ```bash
   npm run build && npx wrangler deploy
   ```
   The first deploy creates the Worker project on Cloudflare using the name from `wrangler.jsonc` (`10x-astro-starter` — rename to `vault-view` in `wrangler.jsonc` before first deploy). Subsequent deploys update the existing Worker.

5. **Verify**:
   ```bash
   npx wrangler tail
   ```
   Open the deployed URL and confirm the app loads. Tail logs to verify Supabase auth flow works in production.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions workflow already exists at `.github/workflows/ci.yml`)
- Production-scale architecture (multi-region, HA, DR)
- Durable Objects implementation details (evaluated for feasibility, not designed)
- Cloudflare Access configuration (mentioned in risk register, not implemented)
