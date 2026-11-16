# Code Organization: one application, strict logical layers

ShadowTrix is **one Next.js application** (decision unchanged: see [technology-decisions.md](technology-decisions.md)). It is not split into a separate frontend app and a separate backend service, because nothing here needs it: the API is consumed only by our own pages, there is one team, one deployment and one database, and a second process would add a network hop, duplicate authentication and a second deploy for no benefit. Next.js route handlers *are* the backend; React pages *are* the frontend; they run from the same `npm run dev` / `npm start`. If a separate public API consumer or independent scaling is ever needed, the service layer below is already framework-free enough to be put behind another transport.

The separation is logical and **enforced by tests** (`web/tests/architecture.test.ts`) and ESLint (`no-restricted-imports`).

## Layers (actual paths)

| Layer | Where | Contains | May import |
|---|---|---|---|
| **Frontend** | `src/app/**/page.tsx`, `layout.tsx`; `src/components/**`; `src/lib/**`; `src/types`; `src/content` | pages, layouts, UI components, forms (client components call the HTTP API through `components/auth/api.ts`), browser-safe helpers (formatting, status derivation, password-policy constants), styles (`app/globals.css`) | frontend code; backend **services** only from server components (pages), never from `"use client"` files |
| **Backend** | `src/app/api/**/route.ts`; `src/server/**` | route handlers (validate with Zod, authorize, call a module, shape the response); `server/modules/*` business services (`auth`, `authz`, `admin`, `events`, `email`, `audit`, `health`, `maintenance`); `server/security` (tokens, rate limit, CSRF, TOTP, secret box); `server/http` (handler wrapper, errors); `server/config`; `server/logging` | other backend code, database layer |
| **Database** | `prisma/schema.prisma`, `prisma/migrations`, `prisma/seed.ts`, `prisma/*.ts` CLI scripts; `src/generated/prisma` (generated client); `src/server/db/client.ts` | schema, additive migrations with hand-written CHECK constraints, trigger and partial indexes, client construction | nothing from the app |
| **Shared contracts** | `src/lib/*` (constants such as `password-policy`, `event-categories`, `roles`), `src/types`, and the **pure** Zod/rule modules `server/modules/*/*.schema.ts`, `authz/permissions.ts`, `events/event-lifecycle.ts` | browser-safe constants and types; pure validation and rules with no framework, database or I/O imports | only each other |

"Repository" in the requested vocabulary: the project deliberately keeps queries inside each module's service file (Prisma is already a typed repository abstraction, and a second wrapper per table would be an unnecessary abstraction). The boundary that matters is enforced: **only `src/server` touches the database client**; pages and components never do.

## Keeping database and secret code out of browser bundles

1. Every backend file that reaches the database, the environment, `node:crypto`, `next/headers`, Argon2 or SMTP starts with `import "server-only"`, so importing it from a client component fails the build.
2. `tests/architecture.test.ts` additionally asserts: no `"use client"` file imports `@/server`, `@/generated`, `@prisma` or `node:*`; `lib/`, `types/` and `content/` import no backend code; only `src/server` imports the database client; route handlers contain no database calls; every state-changing handler is wrapped in `apiHandler`; pure rule modules have no framework imports; every sensitive server file is `server-only` (three pure modules are allow-listed on purpose and documented in the test).
3. ESLint blocks `@/server/db/*`, `@/generated/*` and Prisma imports from `src/app` and `src/components`.

## Findings from the review of the real code (no files were moved)

| Finding | Severity | Action |
|---|---|---|
| No `"use client"` file imports backend code; no page or component imports Prisma | none | recorded and now enforced by a test |
| ESLint only blocked the database layer, not other `@/server` imports from client files | low | closed by the architecture test |
| `profileSchema` lived in `events/event.schema.ts` although it belongs to the account/profile module | low | moved to `auth/profile.schema.ts` |
| Small one-off Zod schemas are declared inside some route files (MFA, registration list, admin users) | informational | accepted: single-use parameter/body shapes may stay in the route; anything reused or mirrored by a form belongs in a module `*.schema.ts` |
| Form limits (for example `maxLength` on the event form) repeat server limits by hand; only the password policy has a shared constant | low | open: generate form hints from shared constants when the forms are next touched |
| Authorization ran after the event row lock in update/status | medium | fixed: authorize first, then lock (tested) |
| Register and cancel had no rate limit | medium | fixed: 30 per minute per person (tested) |
| `src/lib` plays the "shared" role and is not split from frontend-only helpers | informational | acceptable at this size; revisit if a second consumer appears |

## Where new work goes

New feature `X`: Prisma models and an additive migration in `prisma/`; `server/modules/x/{x.schema.ts (pure), x-rules.ts (pure), x.service.ts (server-only)}`; route handlers in `app/api/v1/x/**` using `apiHandler`; pages in `app/x/**`; components in `components/x/**`; client forms call the API via `sendJson`. Add tests beside the existing ones; the architecture test will fail if a layer rule is broken.
