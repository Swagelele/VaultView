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

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Roadmap (lesson focus)** | |
| `/10x-roadmap` | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed** | |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready. |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
