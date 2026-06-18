# Lumio — Authentication Design

**Date:** 2026-06-18
**Status:** Approved (design)
**Builds on:** walking-skeleton, albums, uploads (roadmap #5 productionization)

## Goal
Gate the entire Lumio web app — every page **and** every `/api/*` data route — behind authentication so it can be safely exposed to the internet through a Cloudflare tunnel from a NAS. Use **Better Auth** (email + password) with a **Prisma adapter** plugging into the existing `@lumio/db` chokepoint, and the shadcn **`login-02`** block (trimmed) for the form. A **first-run setup flow** lets you create exactly one admin account while zero users exist; afterwards account creation is permanently closed and the app is login-only.

Better Auth is chosen specifically so a future Expo mobile app can reuse the same auth server via its client SDK — no auth rework later.

## Decisions (brainstorm)
1. **One-and-done admin.** Account creation is allowed only while `user count == 0`. The first account created closes the door; additional users/invites/signups are a later feature. (Chosen over an "open setup window" — narrower exposure on a public URL.)
2. **No social login now.** Email + password only. The `login-02` form is trimmed to email/password/submit (no Apple/Google buttons, no signup link). The Better Auth config is structured so adding a provider later is a few lines + a button. (Apple/Google explicitly deferred.)
3. **Better Auth server lives in `apps/web`; auth tables live in `packages/db`.** The server `auth` instance and React client need Next + Prisma, so they belong to the web app. The four Better Auth tables go in `schema.prisma`, keeping `packages/db` the single DB chokepoint. A separate `packages/auth` package was rejected as premature — the future mobile app reuses the **client** against the web server, not a shared server module.
4. **Defense-in-depth route protection.** Middleware does an edge-safe optimistic cookie redirect (fast UX, not a security boundary). The real gate is server-side: an `(app)` route-group layout enforces the session for pages, and a `requireSession()` helper returns `401` in every protected API route. (Chosen over middleware-only — Better Auth documents that middleware must not be relied on for security, and it would leave the API open.)
5. **Auth is orthogonal to photos for now.** Single-tenant: no per-user ownership on `Photo`/`Album`. Multi-tenant is out of scope.
6. **No email transport yet.** Email verification is disabled and the forgot-password link is removed. Password reset is a follow-up; until then an admin resets via the DB.

## Architecture & file layout
```
packages/db/prisma/schema.prisma              + User, Session, Account, Verification models (+ migration)
packages/db/src/users.ts                       hasAnyUser() / countUsers() (chokepoint helper)
packages/db/src/index.ts                        re-export users helpers

apps/web/src/lib/auth.ts                        Better Auth server instance (prismaAdapter, emailAndPassword)
apps/web/src/lib/auth-client.ts                 better-auth/react client (signIn, signOut, useSession)
apps/web/src/lib/require-session.ts             server helper → 401 if no session (API routes)
apps/web/src/app/api/auth/[...all]/route.ts     Better Auth handler (GET/POST, runtime nodejs)
apps/web/src/middleware.ts                       optimistic cookie redirect + public allowlist

apps/web/src/app/layout.tsx                      ROOT layout stripped to html/body/fonts/globals (no sidebar)
apps/web/src/app/(app)/layout.tsx                sidebar + modal slot + server requireSession→redirect
apps/web/src/app/(app)/...                       existing pages MOVED here (see "App route group" below)
apps/web/src/app/login/page.tsx                  login-02 (trimmed); 0 users → redirect /setup
apps/web/src/app/setup/page.tsx                  create-admin form; ≥1 user → redirect /login
apps/web/src/components/ui/login-form.tsx        from `npx shadcn add login-02`, trimmed
apps/web/src/components/logout-button.tsx        signOut() → /login (placed in sidebar)
```

## `packages/db` — auth tables + count helper
Better Auth's standard schema is added to `schema.prisma`, generated with `npx @better-auth/cli generate` (which appends the models), then applied via `prisma migrate dev`. Models:

- **User** — `id`, `email` (unique), `name`, `emailVerified` (Boolean), `image?`, `createdAt`, `updatedAt`.
- **Account** — provider/account linkage; **holds the password hash** for email+password and future social provider links. FK → User.
- **Session** — `id`, `token` (unique), `userId`, `expiresAt`, `ipAddress?`, `userAgent?`, timestamps. FK → User.
- **Verification** — identifier/value/expiresAt (used by Better Auth internals; present even though email verification is off).

No changes to `Photo` / `Album` / `AppSettings`.

New chokepoint helper `packages/db/src/users.ts`:
- `countUsers(): Promise<number>` → `prisma.user.count()`.
- `hasAnyUser(): Promise<boolean>` → `countUsers() > 0`.

Exported from `packages/db/src/index.ts`. Keeps all `prisma.user` access inside the DB package; the web app calls these helpers rather than touching Prisma directly. (Better Auth's adapter uses the same `prisma` client internally — that's fine, it's one client.)

## `apps/web` — Better Auth server (`lib/auth.ts`)
```ts
betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.BETTER_AUTH_URL!],   // public Cloudflare hostname
  hooks: { /* before user-create: throw if a user already exists */ },
})
```
- **Hard gate on account creation** — a Better Auth `before` hook (matching the sign-up path) calls `hasAnyUser()` and throws an `APIError` (403) if a user already exists. This is the real enforcement: even a direct `POST /api/auth/sign-up/email` cannot create a second account. The `/setup`↔`/login` redirects below are UX only.
- **Handler** — `app/api/auth/[...all]/route.ts` exports `GET`/`POST` from `toNextJsHandler(auth)`, `runtime = "nodejs"`.
- **Client** — `lib/auth-client.ts` via `createAuthClient()` exposing `signIn`, `signOut`, `useSession`.

## App route group (page protection + sidebar)
The sidebar currently renders in the root layout, which would wrongly appear on `/login` and `/setup`. Restructure:
- **Root `layout.tsx`** → trimmed to `<html>`/`<body>`/fonts/`globals.css` only. No sidebar, no `pl-[76px]`, no modal slot.
- **New `(app)/layout.tsx`** → renders `<AppSidebar/>`, the `pl-[76px]` content wrapper, **and the `@modal` parallel slot**; first calls `auth.api.getSession({ headers: await headers() })` and `redirect("/login")` if null.
- **Move into `(app)/`** (mechanical, preserving internal structure): `page.tsx`, `photos/`, `albums/`, `settings/`, `upload/`, `photo/`, and the `@modal/` parallel route. Imports use the `@/` alias so no import paths change.
- `/login` and `/setup` are top-level routes using the now-minimal root layout (no sidebar).

## Auth flow & routing
- **Fresh deploy (0 users):** any protected route → middleware → `/login` → server component sees `!hasAnyUser()` → `redirect("/setup")`. Setup form creates the admin (email + password + confirm) via the client `signUp.email`; Better Auth signs in and we redirect to `/`.
- **Normal (≥1 user):** `/setup` server component sees a user exists → `redirect("/login")`. Login → session cookie → `(app)`.
- **Logout:** sidebar button → `signOut()` → `/login`.

The `0-users → /setup` and `≥1-user → /login` redirects live in the `/login` and `/setup` **server components** (Node runtime, can query Prisma) — middleware stays DB-free.

## Route protection details
- **`middleware.ts`** (edge) — public allowlist: `/login`, `/setup`, `/api/auth/*`, and Next internals/static assets. Any other path with no Better Auth session cookie → `redirect("/login")`. Uses Better Auth's edge-safe cookie-presence read (`getSessionCookie`); **no DB call**. Pure path-matcher logic is unit-tested.
- **`(app)/layout.tsx`** (server) — real session check for all pages (above).
- **`requireSession()`** (`lib/require-session.ts`) — `auth.api.getSession({ headers })`; returns the session or throws/returns a `401 NextResponse`. Added to every protected API route: `GET/POST /api/photos`, `/api/photos/[id]`, `/api/photos/purge`, `/api/albums`, `/api/albums/[id]`, `/api/uploads`, `/api/settings`, `/api/rescan`, `/api/thumbnails/[id]`, and the photo `display` route. `/api/auth/*` is **not** wrapped (Better Auth owns it).

## Login / Setup UI
- `npx shadcn add login-02` → two-column page (form + cover image) plus a `login-form` component.
- **Trim** the form to: email, password, submit. Remove social buttons, the signup link, and the forgot-password link (no email transport yet).
- `/login/page.tsx` renders the trimmed form, wired to `authClient.signIn.email`, with inline error display on bad credentials.
- `/setup/page.tsx` reuses the same two-column shell with a "Create your admin account" heading and an added **confirm-password** field, wired to `authClient.signUp.email`.

## Env & deployment
- New env vars (added to `.env`, `.env.example`, and the `web` service of `infra/docker-compose.prod.yml`):
  - `BETTER_AUTH_SECRET` — random 32+ byte secret (document `openssl rand -base64 32`).
  - `BETTER_AUTH_URL` — the public Cloudflare hostname, e.g. `https://photos.example.com`. Drives `Secure` cookies and `trustedOrigins`/CSRF behind the tunnel.
- **Cloudflare tunnel** runs outside the app (`cloudflared` ingress → `web:3000`). Documented in the README, not hard-wired into compose. README notes that `BETTER_AUTH_URL` **must** be the external HTTPS hostname or cookies/CSRF will misbehave.
- **Conductor dev workspaces:** the lifecycle scripts make auth work per-workspace without manual edits. `scripts/conductor/setup.sh` generates a strong `BETTER_AUTH_SECRET` into `.env` when it's missing or still a placeholder; `scripts/conductor/run.sh` exports `BETTER_AUTH_URL=http://localhost:$PORT` (the reserved `CONDUCTOR_PORT`) so `trustedOrigins` matches the actual serving port — otherwise sign-in fails the origin/CSRF check. (`dotenv-cli` does not override an already-exported var, so the runtime export wins over `.env`.)
- The Dockerfile already builds the whole workspace; the only addition is the new env vars at runtime. `prisma migrate deploy` (already in the entrypoint) applies the auth tables on first boot.

## Testing
TDD on the pure/isolatable logic:
- `hasAnyUser` / `countUsers` (db package).
- The "only-first-user" create hook — rejects when a user exists, allows when none.
- The middleware **public-path matcher** (pure function: given a pathname, is it public?).

Auth wiring is browser-verified per the project's usual flow: fresh DB → land on `/setup` → create admin → redirected in → logout → hitting a protected route and an API route while logged out both redirect/401 → log back in.

## Out of scope (explicit follow-ups)
- Multiple users / invites / open signups.
- Apple & Google social login (config structured for easy addition).
- Expo mobile client (the reason Better Auth was chosen; server is ready).
- Password-reset email / email verification (needs an email transport).
- Per-user photo ownership / multi-tenant.
