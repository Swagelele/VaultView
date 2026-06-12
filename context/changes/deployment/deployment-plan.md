# Cloudflare Workers Deployment Plan -- VaultView

## Context

VaultView is an Astro 6 SSR crypto portfolio tracker already configured for Cloudflare Workers (`@astrojs/cloudflare` adapter, `wrangler.jsonc`, `astro:env/server` secrets). The project has never been deployed. This plan takes it from local dev to production on Cloudflare Workers, with automatic deploys via Workers Builds (Cloudflare's native Git integration, GA since Sep 2025).

The codebase is ~85% deploy-ready. The remaining work: rename the Worker, add deploy scripts, add defensive prerender guards, remove unused sitemap integration, and configure Cloudflare + Supabase cloud services.

---

## Phase 0: Prerequisites (User Manual Steps)

> These steps require browser/interactive actions. The agent cannot do them.

### 0.1 Node.js

- [x] Verify Node.js 22.x is installed: `node -v` should show `v22.x` (project pins `22.14.0` in `.nvmrc`)
- [x] If not installed, download from https://nodejs.org/ or use `nvm install 22.14.0`
- [x] Run `npm ci` in the project root to install dependencies from lockfile

### 0.2 Cloudflare Account and Wrangler CLI

The project already includes `wrangler@^4.90.0` as a devDependency -- no global install needed. All commands use `npx wrangler`.

**Step-by-step:**

1. **Create a Cloudflare account** (skip if you already have one)
   - [x] Go to https://dash.cloudflare.com/sign-up
   - [x] Sign up with email + password or Google/GitHub OAuth
   - [x] Free plan is sufficient for MVP (100k requests/day)
   - [x] Verify your email if prompted

2. **Authenticate the Wrangler CLI**
   - [x] Run `npx wrangler login` in the project root
   - [x] A browser window opens -- log in with your Cloudflare credentials and authorize wrangler
   - [x] The CLI stores an OAuth token locally at `~/.wrangler/config/default.toml`
   - [x] Verify it worked: `npx wrangler whoami` should print your account name and account ID

3. **Note your Account ID** (needed for Phase 3)
   - [x] Copy the Account ID from `npx wrangler whoami` output, or find it in the Cloudflare dashboard under **Workers & Pages** (right sidebar)
   - [x] You'll need this when configuring Workers Builds

**Wrangler CLI troubleshooting:**

| Problem | Solution |
|---------|----------|
| `wrangler login` browser doesn't open | Run `npx wrangler login --browser=false` -- it prints a URL you can copy-paste into any browser |
| `wrangler login` on a headless/remote machine | Create an API token manually: go to https://dash.cloudflare.com/profile/api-tokens > Create Token > use the "Edit Cloudflare Workers" template > copy the token. Then set it: `export CLOUDFLARE_API_TOKEN=<token>`. Wrangler picks it up automatically |
| `wrangler whoami` shows wrong account | Run `npx wrangler logout` then `npx wrangler login` to re-authenticate |
| `npx wrangler` not found | Run `npm ci` to install dependencies. Wrangler is a devDependency in `package.json` |
| Permission denied / EACCES | Don't use `sudo`. If npm global prefix is wrong, fix with `npm config set prefix ~/.npm-global` and add to PATH |

### 0.3 Supabase Cloud Project

VaultView uses Supabase for authentication (email/password login via `@supabase/ssr`). For production, you need a cloud Supabase project. The app requires exactly two values: `SUPABASE_URL` and `SUPABASE_KEY`.

**Step-by-step:**

1. **Create a Supabase account** (skip if you already have one)
   - [x] Go to https://supabase.com/dashboard
   - [x] Sign up with GitHub (recommended -- fastest) or email

2. **Create a new project**
   - [x] Click **New Project** in the dashboard
   - [x] Choose your organization (or create one)
   - [x] Fill in:
     - **Project name**: `vault-view` (or any name you prefer)
     - **Database password**: generate a strong password and save it somewhere safe (you won't need it in the app, but you'll need it if you ever connect directly to the database)
     - **Region**: pick the closest to your primary users (e.g., `eu-central-1` for Europe, `us-east-1` for US East)
   - [x] Click **Create new project**
   - [x] Wait ~2 minutes for provisioning to complete

3. **Copy the API credentials**
   - [x] Once the project is ready, go to **Settings** (gear icon in sidebar) > **API**
   - [x] Under **Project URL**, copy the URL (looks like `https://abcdefgh.supabase.co`) -- this is your `SUPABASE_URL`
   - [x] Under **Project API keys**, copy the `anon` `public` key (the long JWT string) -- this is your `SUPABASE_KEY`
   - [x] **Do NOT copy the `service_role` key** -- the app uses the `anon` key which respects Row Level Security

4. **Configure email confirmation (recommended for testing)**
   - [x] Go to **Authentication** (sidebar) > **Sign In / Up** > **Email**
   - [x] If you want to test sign-up without checking email: toggle **Confirm email** to OFF
   - [x] For production: leave it ON and configure an SMTP provider under **Authentication** > **SMTP Settings** (otherwise Supabase uses its built-in email with strict rate limits: 2 emails/hour on free plan)

5. **Save credentials locally for development**
   - [x] Create a `.dev.vars` file in the project root (already gitignored):
     ```
     SUPABASE_URL=https://your-project-ref.supabase.co
     SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...your-anon-key
     ```
   - [x] Also create/update `.env` for `astro sync` and IDE support:
     ```
     SUPABASE_URL=https://your-project-ref.supabase.co
     SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...your-anon-key
     ```
   - [x] **Never commit `.dev.vars` or `.env`** -- both are in `.gitignore`

**Supabase troubleshooting:**

| Problem | Solution |
|---------|----------|
| Can't find API keys | Dashboard > Settings (gear icon) > API. The URL and keys are at the top of the page |
| "Invalid API key" error in the app | Make sure you copied the `anon` key (not `service_role`). Check for trailing whitespace or line breaks in your `.dev.vars` |
| Sign-up works but can't sign in | Email confirmation is likely ON. Either: (a) check your email and click the confirmation link, or (b) turn off email confirmation in Authentication > Sign In / Up > Email |
| "Email rate limit exceeded" on sign-up | Free plan allows 2 emails/hour. Wait, or disable email confirmation for testing |
| Project stuck on "Setting up" | Wait up to 5 minutes. If still stuck, delete and recreate the project. If persistent, check https://status.supabase.com |
| Want to use local Supabase instead | Run `npx supabase start` (requires Docker + ~7GB RAM). Copy credentials from CLI output to `.dev.vars`. See README.md for full local setup instructions |

### 0.4 Verify everything works locally

Before deploying, confirm the full stack runs locally:

- [x] Run `npm run dev` -- the dev server should start on `http://localhost:4321`
- [x] Open `http://localhost:4321` -- landing page loads
- [x] Open `http://localhost:4321/auth/signup` -- sign-up form renders
- [x] Create a test account and verify sign-in works
- [x] Navigate to `/dashboard` -- should show "Welcome, [email]" if signed in, or redirect to `/auth/signin` if not

If all checks pass, you're ready for Phase 1 (agent code changes) and Phase 2 (deploy).

---

## Phase 1: Code Preparation (Agent Steps)

> All changes are file modifications. No external services touched.

### 1.1 Rename Worker project

**File:** `wrangler.jsonc`
- Change `"name": "10x-astro-starter"` to `"name": "vault-view"`
- Why: Worker name becomes the subdomain (`vault-view.<account>.workers.dev`). Must be renamed before first deploy.

### 1.2 Update package.json

**File:** `package.json`
- Change `"name": "10x-astro-starter"` to `"name": "vault-view"`
- Add scripts:
  - `"deploy": "astro build && wrangler deploy"` -- manual production deploy
  - `"deploy:dry-run": "astro build && wrangler deploy --dry-run"` -- validate build + bundle size without deploying
  - `"deploy:preview": "astro build && wrangler versions upload"` -- upload a version without promoting to production

### 1.3 Remove sitemap integration

**File:** `astro.config.mjs`
- Remove `import sitemap from "@astrojs/sitemap";`
- Remove `sitemap()` from the `integrations` array
- Why: No `site` URL is set (causes build warning), and VaultView is login-gated -- only the landing page is public. SEO/sitemap is unnecessary. Can be re-added later if public marketing pages are built.

**Then run:** `npm uninstall @astrojs/sitemap`

### 1.4 Add defensive `prerender = false` guards

Add `export const prerender = false;` to all dynamic pages and API routes. While `output: "server"` in astro.config.mjs already defaults all pages to SSR, explicit declarations prevent regressions and document intent (flagged in infrastructure.md risk register).

**Astro pages** (add as first line of frontmatter `---` block):
- `src/pages/dashboard.astro`
- `src/pages/auth/signin.astro`
- `src/pages/auth/signup.astro`
- `src/pages/auth/confirm-email.astro`

**API routes** (add as first line of file, before imports):
- `src/pages/api/auth/signin.ts`
- `src/pages/api/auth/signup.ts`
- `src/pages/api/auth/signout.ts`

### 1.5 Create `.dev.vars.example`

**File:** `.dev.vars.example` (NEW)
```
# Cloudflare Workers local dev secrets
# Copy to .dev.vars and fill in real values from your Supabase project
# .dev.vars is gitignored — wrangler reads it instead of .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
```
- Why: `.dev.vars` is how wrangler injects secrets locally. `.env.example` exists but `.dev.vars` is the Cloudflare-specific file. `.dev.vars` is already in `.gitignore`.

### 1.6 Verify build

- Run `npx astro sync` (regenerate types after config change)
- Run `npm run build` -- must complete with zero errors
- Run `npm run deploy:dry-run` -- validates bundle size and Worker compatibility

### Troubleshooting (Phase 1)

| Problem | Solution |
|---------|----------|
| Build fails after prerender export | Ensure `export const prerender = false;` is inside the `---` frontmatter block for `.astro` files, and at the top level (before imports) for `.ts` API routes |
| `astro sync` fails | Delete `.astro/` directory and re-run |
| Bundle size warning from `wrangler deploy --dry-run` | Check for heavy server-side imports. Astro 6 + React 19 + Supabase should be well within limits. If flagged, review `npm ls` for unexpected large dependencies |

---

## Phase 2: First Manual Deploy

> Mix of agent and user actions. This establishes the Worker on Cloudflare.

### 2.1 Deploy the Worker

**[AGENT]** Run `npm run deploy` (executes `astro build && wrangler deploy`)

- First `wrangler deploy` creates the Worker project on Cloudflare
- Output: deployment URL `https://vault-view.<account>.workers.dev`
- The app will load but **auth won't work yet** (secrets not set)

### 2.2 Set Cloudflare secrets

**[USER]** Run these commands and paste the values from your Supabase dashboard when prompted:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Secrets are encrypted at rest, scoped to the Worker, and injected at runtime. No redeploy needed -- the Worker picks them up on the next request.

### 2.3 Verify deployment

**[USER]** Open the deployed URL in a browser. **[AGENT]** can run `npx wrangler tail` to stream live logs.

| Check | Expected result | What it proves |
|-------|-----------------|----------------|
| Open `/` | Landing page loads with styled content | Static assets + SSR work on Workers |
| Open `/auth/signin` | Sign-in form renders, React hydrates | Island architecture works on workerd |
| Submit signin with bad credentials | Redirect to `/auth/signin?error=...` | SSR form handling + Supabase connection from Worker + cookies |
| Navigate to `/dashboard` directly | Redirect to `/auth/signin` | Middleware runs and protects routes |
| Check `wrangler tail` output | Request logs appear for each action | Observability enabled |
| Sign in with real Supabase credentials | `/dashboard` shows "Welcome, [email]" | Full auth flow works end-to-end |

### Troubleshooting (Phase 2)

| Problem | Solution |
|---------|----------|
| "Authentication error" on deploy | Re-run `npx wrangler login` |
| "Script too large" | Run `npm run deploy:dry-run` for size report. Check for heavy server imports |
| App loads but auth silently fails (no error, redirect to home) | Secrets not set or wrong values. Run `npx wrangler secret list` to verify names are present. Re-set with correct values |
| 500 error on any page | Run `npx wrangler tail`, check error. If it references Node built-in, verify `nodejs_compat` is in `compatibility_flags` in `wrangler.jsonc` |
| Static assets (CSS/JS) 404 | Verify `"directory": "./dist"` in `wrangler.jsonc` matches build output. Run `ls dist/` after build |
| React islands don't hydrate | Check browser console for JS errors. Likely a client directive or import issue |
| `wrangler secret put` fails with "Worker not found" | Normal if this is the first deploy. Deploy first (step 2.1), then set secrets |

---

## Phase 3: Workers Builds -- Native Auto-Deploy

> Cloudflare Workers Builds (GA Sep 2025) provides native Git integration. No GitHub Actions needed for deploys.

### 3.1 Connect GitHub repo to Cloudflare

**[USER]** In the Cloudflare dashboard:

1. Go to **Workers & Pages** > select the **vault-view** Worker
2. Go to **Settings > Builds**
3. Click **Connect repository**
4. Install/authorize the **Cloudflare Workers & Pages** GitHub App on your repo
5. Select the repository

### 3.2 Configure build settings

**[USER]** In the Workers Builds configuration:

| Setting | Value |
|---------|-------|
| **Build command** | `npm run build` |
| **Deploy command** | `npx wrangler deploy` (default) |
| **Root directory** | `/` (repository root) |
| **Production branch** | `master` |

- **Important**: The Worker name in the dashboard (`vault-view`) must match `"name"` in `wrangler.jsonc`. We already renamed it in Phase 1.1.
- Build environment variables: `SUPABASE_URL` and `SUPABASE_KEY` should be set as **runtime secrets** (already done in Phase 2.2), NOT as build variables. Astro's env schema marks them as `optional: true`, so the build succeeds without them.

### 3.3 Verify auto-deploy

**[USER]**
1. Push a trivial commit to `master` (e.g., whitespace change in a comment)
2. In Cloudflare dashboard > Workers & Pages > vault-view > Builds, verify the build triggers and completes
3. Open the deployed URL and confirm the app still works

### 3.4 Optional: Enable preview deploys for PRs

Workers Builds can auto-deploy non-production branches using `npx wrangler versions upload` (produces preview URLs without promoting to production). Enable this in Settings > Builds if you want PR preview environments.

**Security note from infrastructure.md**: Preview deploy URLs are public by default. For a financial app, configure [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) (free for up to 50 users) on the `*.workers.dev` subdomain before enabling PR previews.

### Troubleshooting (Phase 3)

| Problem | Solution |
|---------|----------|
| Build fails in Workers Builds | Check build logs in Cloudflare dashboard. Most common: Node.js version mismatch (project needs 22.x -- Workers Builds should detect from `.nvmrc`) |
| "Worker name mismatch" | Ensure `"name"` in `wrangler.jsonc` matches the Worker name in the Cloudflare dashboard exactly |
| Build succeeds but deploy fails | Check that `npx wrangler deploy` works locally first. The deploy command in Workers Builds uses the wrangler version from your `package.json` |
| Git integration not appearing | Ensure the Cloudflare Workers & Pages GitHub App has access to your repository. Check GitHub Settings > Integrations |

---

## Phase 4: Documentation and Artifacts

> Agent creates deployment documentation.

### 4.1 Create `context/deployment/deploy-plan.md`

**Directory:** `context/deployment/` (NEW)
**File:** `context/deployment/deploy-plan.md`
- Cleaned-up version of this plan with actual URLs and completion timestamps
- Serves as the audit trail referenced by CLAUDE.md

### 4.2 Update CLAUDE.md

**File:** `CLAUDE.md`
- Add deploy commands to the Commands section:
  - `npm run deploy` -- build and deploy to Cloudflare Workers
  - `npm run deploy:dry-run` -- validate without deploying
  - `npm run deploy:preview` -- upload version without promoting
  - `npx wrangler tail` -- stream live Worker logs
  - `npx wrangler secret put <KEY>` -- set a Worker secret
  - `npx wrangler secret list` -- list configured secrets (names only)

---

## Rollback Strategy

**Immediate rollback (< 30 seconds globally):**
```bash
npx wrangler versions list          # see recent deployments
npx wrangler versions deploy <id>   # promote a previous version
```

**Limitations:**
- Secrets are NOT versioned -- rolling back code doesn't roll back secrets
- Supabase migrations don't auto-rollback -- plan rollback scripts separately
- Static assets are versioned with the deployment (rollback includes assets)

---

## Files Modified by This Plan

| File | Action | Phase |
|------|--------|-------|
| `wrangler.jsonc` | Rename worker to `vault-view` | 1.1 |
| `package.json` | Rename + add deploy scripts | 1.2 |
| `astro.config.mjs` | Remove sitemap integration | 1.3 |
| `src/pages/dashboard.astro` | Add `prerender = false` | 1.4 |
| `src/pages/auth/signin.astro` | Add `prerender = false` | 1.4 |
| `src/pages/auth/signup.astro` | Add `prerender = false` | 1.4 |
| `src/pages/auth/confirm-email.astro` | Add `prerender = false` | 1.4 |
| `src/pages/api/auth/signin.ts` | Add `prerender = false` | 1.4 |
| `src/pages/api/auth/signup.ts` | Add `prerender = false` | 1.4 |
| `src/pages/api/auth/signout.ts` | Add `prerender = false` | 1.4 |
| `.dev.vars.example` | NEW -- local dev secrets template | 1.5 |
| `context/deployment/deploy-plan.md` | NEW -- deployment audit trail | 4.1 |
| `CLAUDE.md` | Add deploy commands | 4.2 |

## Verification Summary

| Phase | Verification command / action |
|-------|-------------------------------|
| 1 (Code prep) | `npm run deploy:dry-run` passes cleanly |
| 2 (First deploy) | All 6 checks in the verification table pass |
| 3 (Workers Builds) | Push to master triggers auto-build + deploy in Cloudflare dashboard |
| 4 (Docs) | `context/deployment/deploy-plan.md` exists with completion timestamps |
