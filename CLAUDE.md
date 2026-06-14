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

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill                                  | Use it when                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Change setup (lesson focus)**        |                                                                                                                                                                                                                                                                      |
| `/10x-new <change-id>`                 | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`.               |
| **Planning (lesson focus)**            |                                                                                                                                                                                                                                                                      |
| `/10x-plan <change-id>`                | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-plan-review <change-id>`         | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin.                                                                          |
| **Implementation (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`.                                                                                                                          |
| **Lifecycle closure**                  |                                                                                                                                                                                                                                                                      |
| `/10x-archive <change-id>`             | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state.                                                                                                                                                             |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
