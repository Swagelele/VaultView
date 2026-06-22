# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier
- `npx astro sync` — regenerate Astro type definitions (run after changing `env.schema` in astro.config.mjs)
- `npx supabase start` / `npx supabase stop` — local Supabase stack (requires Docker)
- `npm run deploy` — build and deploy to Cloudflare Workers
- `npm run deploy:dry-run` — validate build + bundle size without deploying
- `npm run deploy:preview` — upload a version without promoting to production
- `npx wrangler tail` — stream live Worker logs
- `npx wrangler secret put <KEY>` — set a Worker secret
- `npx wrangler secret list` — list configured secrets (names only)

Pre-commit hook (husky + lint-staged): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`.

## Architecture

Astro 6 SSR app ("VaultView" — crypto portfolio tracker) with React 19 islands, Tailwind CSS 4, Supabase auth, and shadcn/ui. Deployed to Cloudflare Workers via `@astrojs/cloudflare` adapter.

### Rendering & runtime

Full SSR (`output: "server"` in astro.config.mjs). Every page is server-rendered. The runtime is Cloudflare's workerd, not Node.js — avoid Node-only APIs (fs, path, crypto) in server code.

### Auth flow

1. `src/lib/supabase.ts` — server-side Supabase client using `@supabase/ssr` with cookie-based sessions. Env vars come from `astro:env/server` (declared in astro.config.mjs `env.schema`), not `process.env`.
2. `src/middleware.ts` — resolves user on every request, sets `context.locals.user`. Protect routes by adding paths to the `PROTECTED_ROUTES` array.
3. API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts` — form POST handlers that redirect on success/error.
4. Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
5. `createClient()` returns `null` when Supabase env vars are missing — all callers must handle the null case.

### Key conventions

- **Path alias**: `@/*` → `./src/*` (tsconfig paths). Always use `@/` imports, never relative `../../`.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge). Do not concatenate class strings manually.
- **shadcn/ui**: see @components.json for paths and style config.
- **API routes**: export uppercase HTTP methods (`GET`, `POST`). Auth error pattern: redirect with `?error=` query param.
- **Supabase migrations**: `supabase/migrations/` with `YYYYMMDDHHmmss_short_description.sql` naming. Always enable RLS on new tables.
- **Shared types**: `src/types.ts`. Services/helpers: `src/lib/`.

### Environment setup

See @README.md (sections: Getting Started, Supabase Configuration, Deployment). Node version: @.nvmrc

## CI

See @.github/workflows/ci.yml — lint + build on push/PR to master.

## Project context

- PRD: @context/foundation/prd.md
- Tech stack decision: @context/foundation/tech-stack.md

## Project conventions (user-owned — not managed by @przeprogramowani/10x-cli)

### Roadmap sync after implementation (always)

When `/10x-implement` finishes the final phase of a change (i.e. `change.md` flips to `implemented`), **always** update `context/foundation/roadmap.md` automatically, without being asked, to mark the matching roadmap item `done`:

- flip its status in the **At a glance** table,
- flip the slice's `**Status:**` line,
- update its **Backlog Handoff** row (readiness → `done`, Notes → `Implemented — <first-sha>..<epilogue-sha>`),
- bump the roadmap frontmatter `updated:` to today.

Do this as part of closeout, before offering `/10x-archive`. Fold the roadmap edit into the epilogue commit, or land a follow-up `docs:` commit if the epilogue already committed.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
