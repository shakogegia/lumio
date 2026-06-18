# Lumio Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the entire Lumio web app (all pages + all `/api/*` data routes) behind Better Auth email/password login, with a one-time first-run flow that creates exactly one admin account while zero users exist.

**Architecture:** Better Auth server instance + React client live in `apps/web`; the four auth tables (`User`/`Session`/`Account`/`Verification`) live in `packages/db`'s Prisma schema (the single DB chokepoint). Protection is defense-in-depth: a Next 16 proxy (`proxy.ts`, the renamed middleware) does an optimistic cookie redirect, an `(app)` route-group layout enforces the session server-side for pages, and a `requireSession`-style guard returns `401` on every protected API route. A Better Auth `before` hook permanently blocks account creation once a user exists.

**Tech Stack:** Next.js 16 (App Router, `--webpack`), Better Auth (`better-auth`), Prisma 6 + Postgres, shadcn (`login-02` block), Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-lumio-auth-design.md`

**Conventions to follow (from the codebase):**
- DB-touching functions accept an injectable `db` param defaulting to the shared `prisma` (see `packages/db/src/settings.ts`), so they unit-test with a fake client.
- Pure logic is extracted and unit-tested; wiring is browser-verified.
- API routes are `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- `@/` alias = `apps/web/src`.
- Run DB before migrating: `pnpm db:up` (Postgres on host port 5433 via `.env`).

---

## Task 1: Auth tables in Prisma + Better Auth install

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append 4 models)
- Modify: `apps/web/package.json` (add `better-auth` dependency — via pnpm)
- Create (generated): `packages/db/prisma/migrations/<timestamp>_add_auth/`

- [ ] **Step 1: Install Better Auth into the web app**

Run:
```bash
pnpm --filter @lumio/web add better-auth
```
Expected: `better-auth` appears under `dependencies` in `apps/web/package.json`; lockfile updates.

- [ ] **Step 2: Append the Better Auth models to the Prisma schema**

Add to the END of `packages/db/prisma/schema.prisma`:
```prisma
model User {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]
}

model Session {
  id        String   @id @default(cuid())
  expiresAt DateTime
  token     String   @unique
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

model Account {
  id                    String    @id @default(cuid())
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
}

model Verification {
  id         String   @id @default(cuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
}
```

These field names/types match what Better Auth's core (email/password) expects. The `@@index([identifier])` matches Better Auth's `getAuthTables` (it looks up verifications by identifier). `Account.password` stores the bcrypt/scrypt hash; the OAuth columns stay null until a social provider is added later.

- [ ] **Step 3: Start the DB and create the migration**

Run:
```bash
pnpm db:up
pnpm db:migrate --name add_auth
```
Expected: a new migration folder `..._add_auth` is created and applied; output ends with "Your database is now in sync with your schema." (`db:migrate` = `prisma migrate dev`, loads `.env`.)

- [ ] **Step 4: Regenerate the Prisma client**

Run:
```bash
pnpm db:generate
```
Expected: "Generated Prisma Client". `prisma.user`, `prisma.session`, etc. are now typed.

- [ ] **Step 5: Verify nothing else broke**

Run:
```bash
pnpm -r test
```
Expected: all existing tests still pass (46+).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma apps/web/package.json pnpm-lock.yaml
git commit -m "feat(auth): add Better Auth tables to Prisma schema + install better-auth"
```

---

## Task 2: `hasAnyUser` / `countUsers` chokepoint helper (TDD)

**Files:**
- Create: `packages/db/src/users.ts`
- Create: `packages/db/src/users.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/users.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { countUsers, hasAnyUser } from "./users.js";

function fakeDb(count: number) {
  const calls: unknown[] = [];
  return {
    calls,
    user: {
      count: async (args?: unknown) => {
        calls.push(args);
        return count;
      },
    },
  };
}

describe("countUsers", () => {
  it("returns the user table count", async () => {
    const db = fakeDb(3);
    expect(await countUsers(db as never)).toBe(3);
  });
});

describe("hasAnyUser", () => {
  it("is false when there are zero users", async () => {
    expect(await hasAnyUser(fakeDb(0) as never)).toBe(false);
  });

  it("is true when at least one user exists", async () => {
    expect(await hasAnyUser(fakeDb(1) as never)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/db test`
Expected: FAIL — cannot resolve `./users.js`.

- [ ] **Step 3: Implement the helper**

Create `packages/db/src/users.ts`:
```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

/** Number of registered users. */
export async function countUsers(
  db: Pick<PrismaClient, "user"> = prisma,
): Promise<number> {
  return db.user.count();
}

/** True once at least one account exists (used to close first-run setup). */
export async function hasAnyUser(
  db: Pick<PrismaClient, "user"> = prisma,
): Promise<boolean> {
  return (await countUsers(db)) > 0;
}
```

- [ ] **Step 4: Export from the package index**

In `packages/db/src/index.ts`, add after the existing exports:
```ts
export * from "./users.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @lumio/db test`
Expected: PASS (3 new tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/users.ts packages/db/src/users.test.ts packages/db/src/index.ts
git commit -m "feat(auth): hasAnyUser/countUsers db helper"
```

---

## Task 3: Signup gate (pure, TDD)

**Files:**
- Create: `apps/web/src/lib/signup-gate.ts`
- Create: `apps/web/src/lib/signup-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/signup-gate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assertSignupAllowed } from "./signup-gate.js";

describe("assertSignupAllowed", () => {
  it("allows the first signup when no user exists", () => {
    expect(() => assertSignupAllowed("/sign-up/email", false)).not.toThrow();
  });

  it("blocks signup once a user exists", () => {
    expect(() => assertSignupAllowed("/sign-up/email", true)).toThrow();
  });

  it("ignores non-signup paths even when no user exists", () => {
    expect(() => assertSignupAllowed("/sign-in/email", false)).not.toThrow();
    expect(() => assertSignupAllowed("/sign-in/email", true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/signup-gate.test.ts`
Expected: FAIL — cannot resolve `./signup-gate.js`.

- [ ] **Step 3: Implement the gate**

Create `apps/web/src/lib/signup-gate.ts`:
```ts
import { APIError } from "better-auth/api";

/**
 * Enforces "only the first account can be created". Throws a 403 when an
 * email signup is attempted while a user already exists. Pure: the caller
 * passes the current user-existence so this stays unit-testable.
 */
export function assertSignupAllowed(path: string, hasUser: boolean): void {
  if (path !== "/sign-up/email") return;
  if (hasUser) {
    throw new APIError("FORBIDDEN", {
      message: "Registration is closed. An account already exists.",
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/signup-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/signup-gate.ts apps/web/src/lib/signup-gate.test.ts
git commit -m "feat(auth): first-user-only signup gate"
```

---

## Task 4: Better Auth server instance + env vars

**Files:**
- Create: `apps/web/src/lib/auth.ts`
- Modify: `.env`
- Modify: `.env.example`

- [ ] **Step 1: Add the auth env vars**

Append to `.env` (dev values):
```
BETTER_AUTH_SECRET="dev-only-insecure-secret-change-me-0000000000000"
BETTER_AUTH_URL="http://localhost:3000"
```
Append to `.env.example` (documented placeholders):
```
# Auth — generate a real secret with: openssl rand -base64 32
BETTER_AUTH_SECRET="change-me-generate-with-openssl-rand-base64-32"
# Public origin the app is served from (Cloudflare tunnel hostname in prod)
BETTER_AUTH_URL="http://localhost:3000"
```

- [ ] **Step 2: Create the auth instance**

Create `apps/web/src/lib/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { prisma, hasAnyUser } from "@lumio/db";
import { assertSignupAllowed } from "./signup-gate.js";

const baseURL = process.env.BETTER_AUTH_URL;

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: baseURL ? [baseURL] : [],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Permanently close account creation after the first user — this guards
      // the raw endpoint regardless of how it's called.
      assertSignupAllowed(ctx.path, await hasAnyUser());
    }),
  },
});
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm --filter @lumio/web exec tsc --noEmit
```
Expected: no errors. (Confirms imports resolve and `prisma.user` is typed from Task 1.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth.ts .env.example
git commit -m "feat(auth): Better Auth server instance (email+password, signup gate)"
```
(Note: `.env` is gitignored — only `.env.example` is committed.)

---

## Task 5: Auth client + Next.js route handler

**Files:**
- Create: `apps/web/src/lib/auth-client.ts`
- Create: `apps/web/src/app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Create the React client**

Create `apps/web/src/lib/auth-client.ts`:
```ts
"use client";

import { createAuthClient } from "better-auth/react";

// No baseURL → defaults to the current origin, so it works in dev and behind
// the Cloudflare tunnel without a public env var.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 2: Create the catch-all route handler**

Create `apps/web/src/app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 3: Smoke-test the endpoint**

Run (in one terminal): `pnpm db:up && pnpm dev`
Then (another terminal):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/ok
```
Expected: `200` (Better Auth's health route). Stop the dev server afterwards.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth-client.ts "apps/web/src/app/api/auth/[...all]/route.ts"
git commit -m "feat(auth): Better Auth Next.js handler + react client"
```

---

## Task 6: Public-path matcher + server session helper (matcher TDD)

**Files:**
- Create: `apps/web/src/lib/auth-paths.ts`
- Create: `apps/web/src/lib/auth-paths.test.ts`
- Create: `apps/web/src/lib/server-session.ts`

- [ ] **Step 1: Write the failing test for the matcher**

Create `apps/web/src/lib/auth-paths.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isPublicPath } from "./auth-paths.js";

describe("isPublicPath", () => {
  it("treats the login and setup pages as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/setup")).toBe(true);
  });

  it("treats the Better Auth API as public", () => {
    expect(isPublicPath("/api/auth/sign-in/email")).toBe(true);
    expect(isPublicPath("/api/auth/ok")).toBe(true);
  });

  it("treats app pages and data routes as private", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/photos")).toBe(false);
    expect(isPublicPath("/api/photos")).toBe(false);
    expect(isPublicPath("/loginsomething")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/auth-paths.test.ts`
Expected: FAIL — cannot resolve `./auth-paths.js`.

- [ ] **Step 3: Implement the matcher**

Create `apps/web/src/lib/auth-paths.ts`:
```ts
/** Routes reachable without a session: auth pages + the Better Auth API. */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/setup") return true;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/auth-paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the server session helper**

Create `apps/web/src/lib/server-session.ts`:
```ts
import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/** Current session (or null) from request cookies — for server components. */
export async function getServerSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * API-route guard. Returns `{ session }` when authed, or `{ response }` (a 401)
 * when not. Usage:
 *   const guard = await requireSession();
 *   if (guard.response) return guard.response;
 */
export async function requireSession(): Promise<
  | { session: NonNullable<Awaited<ReturnType<typeof getServerSession>>>; response: null }
  | { session: null; response: NextResponse }
> {
  const session = await getServerSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, response: null };
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/auth-paths.ts apps/web/src/lib/auth-paths.test.ts apps/web/src/lib/server-session.ts
git commit -m "feat(auth): public-path matcher + server session guard"
```

---

## Task 7: Proxy (request gate)

**Next.js 16 note:** `middleware.ts` is deprecated and renamed to **`proxy.ts`** (function `middleware` → `proxy`; `config`/`matcher` unchanged). Proxy runs on the **Node.js runtime** (the edge runtime and the `runtime` segment-config are not available in a proxy file — setting `runtime` throws). This suits our design: the gate is a thin cookie-presence check (no DB call), the "thin proxy" pattern Next recommends; `getSessionCookie` works on Node too.

**Files:**
- Create: `apps/web/src/proxy.ts`

- [ ] **Step 1: Create the proxy**

Create `apps/web/src/proxy.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { isPublicPath } from "@/lib/auth-paths";

// Optimistic gate only (cookie presence, no DB). Real enforcement is the
// (app) layout + per-route requireSession. Pages → redirect to /login;
// API routes → 401 JSON.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (!getSessionCookie(request)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals and static asset files; run on everything else.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|txt|xml|woff2?)$).*)",
  ],
};
```

- [ ] **Step 2: Typecheck + confirm no deprecation warning**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors. (Using `proxy.ts` avoids the Next 16 `middleware` deprecation warning; there must be NO `middleware.ts` left in `apps/web/src`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/proxy.ts
git commit -m "feat(auth): proxy request gate (Next 16 proxy.ts)"
```

---

## Task 8: Protect every data API route with a `withAuth` wrapper

Route handlers (`/api/*`) are NOT covered by layouts or the proxy's optimistic check, so each must verify the session itself. To keep that DRY, wrap each handler in a `withAuth` higher-order function that runs `requireSession`, returns the 401 when unauthenticated, and otherwise calls the handler with the validated session.

**Files:**
- Create: `apps/web/src/lib/with-auth.ts`
- Create: `apps/web/src/lib/with-auth.test.ts`
- Modify (refactor each handler to `withAuth`, all under `apps/web/src/app/api/`):
  `photos/route.ts` (GET) · `photos/[id]/route.ts` (GET) · `photos/[id]/display/route.ts` (GET) · `photos/[id]/original/route.ts` (GET) · `photos/purge/route.ts` (POST) · `albums/route.ts` (GET, POST) · `albums/[id]/route.ts` (GET, DELETE) · `albums/[id]/photos/route.ts` (GET, POST) · `albums/[id]/photos/[photoId]/route.ts` (DELETE) · `rescan/route.ts` (POST) · `settings/route.ts` (PUT) · `thumbnails/[id]/route.ts` (GET) · `uploads/route.ts` (POST)

Do NOT touch `api/auth/[...all]/route.ts` — Better Auth owns it.

> Note: Task 8 was first implemented with an inline `requireSession()` guard in each handler; this task refactors all of them to the `withAuth` wrapper. `requireSession`/`getServerSession` stay in `server-session.ts` (the wrapper and the `(app)` layout both use them).

- [ ] **Step 1: Write the failing test for the wrapper**

Create `apps/web/src/lib/with-auth.test.ts` (mocks `server-session` so no DB/`server-only` is loaded):
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSessionMock = vi.fn();
vi.mock("./server-session.js", () => ({
  requireSession: () => requireSessionMock(),
}));

import { withAuth } from "./with-auth.js";

describe("withAuth", () => {
  beforeEach(() => requireSessionMock.mockReset());

  it("returns the 401 response and does NOT call the handler when unauthenticated", async () => {
    const response = new Response("no", { status: 401 });
    requireSessionMock.mockResolvedValue({ session: null, response });
    const handler = vi.fn();
    const result = await withAuth(handler)(new Request("http://x/api"), {});
    expect(result).toBe(response);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler with (request, context, session) when authenticated", async () => {
    const session = { user: { id: "u1" } };
    requireSessionMock.mockResolvedValue({ session, response: null });
    const ok = new Response("ok");
    const handler = vi.fn().mockResolvedValue(ok);
    const req = new Request("http://x/api");
    const ctx = { params: Promise.resolve({ id: "p1" }) };
    const result = await withAuth(handler)(req, ctx);
    expect(result).toBe(ok);
    expect(handler).toHaveBeenCalledWith(req, ctx, session);
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/with-auth.test.ts`
Expected: FAIL — cannot resolve `./with-auth.js`.

- [ ] **Step 3: Implement the wrapper**

Create `apps/web/src/lib/with-auth.ts` (no direct `server-only` import — it's protected transitively via `server-session`, and omitting it lets the wrapper be unit-tested with a mock):
```ts
import { requireSession } from "@/lib/server-session";

// The authenticated session type, derived from requireSession's success branch.
type AuthedSession = Extract<
  Awaited<ReturnType<typeof requireSession>>,
  { response: null }
>["session"];

type AuthedHandler<Ctx> = (
  request: Request,
  context: Ctx,
  session: AuthedSession,
) => Promise<Response> | Response;

/**
 * Wraps a route handler so it only runs for authenticated requests. Returns a
 * 401 (from requireSession) otherwise. The wrapped handler receives the
 * validated session as its third argument. Ctx is inferred from the handler's
 * own context parameter, so dynamic-route `{ params }` typing is preserved.
 */
export function withAuth<Ctx = unknown>(handler: AuthedHandler<Ctx>) {
  return async (request: Request, context: Ctx): Promise<Response> => {
    const guard = await requireSession();
    if (guard.response) return guard.response;
    return handler(request, context, guard.session);
  };
}
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/with-auth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor every route handler to `withAuth`**

In each route file: remove the `requireSession` import + the two inline guard lines, add `import { withAuth } from "@/lib/with-auth";`, and convert each `export async function METHOD(...) {...}` into `export const METHOD = withAuth(async (...) => {...});`. Keep the `runtime`/`dynamic` exports and all body logic unchanged. Handlers that don't need the user can omit the third (`session`) parameter.

Static route — `apps/web/src/app/api/photos/route.ts`:
```ts
import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { listPhotos } from "@/lib/photos-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const parsed = photosQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const page = await listPhotos(parsed.data);
  return NextResponse.json(page);
});
```

Dynamic route — keep the `{ params }` annotation so Next's route types still validate (example shape for `photos/[id]/route.ts`):
```ts
export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    // ...existing body...
  },
);
```
For `albums/[id]/photos/[photoId]/route.ts` the params type is `{ params: Promise<{ id: string; photoId: string }> }`. Multi-method files (`albums/route.ts`, `albums/[id]/route.ts`, `albums/[id]/photos/route.ts`) wrap BOTH exported methods.

- [ ] **Step 6: Verify types (incl. Next route-handler validation) + tests + live 401s**

Run:
```bash
pnpm --filter @lumio/web exec tsc --noEmit
pnpm --filter @lumio/web build      # validates the generated route-handler types for the wrapped exports
pnpm -r test
```
Expected: clean typecheck, successful build (route types accept the `withAuth(...)` exports), all tests pass.

Then live-check a few routes are still 401 when logged out (DB is up; serve on a known port):
```bash
export PORT=3000; export BETTER_AUTH_URL=http://localhost:3000
( pnpm --filter @lumio/web dev & ) ; sleep 9
for p in /api/photos /api/albums "/api/photos/x/display"; do curl -s -o /dev/null -w "$p:%{http_code}\n" "http://localhost:3000$p"; done
pkill -f "next dev"   # leave NO dev server running; confirm with: pgrep -f "next dev"
```
Expected: all `401`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/with-auth.ts apps/web/src/lib/with-auth.test.ts apps/web/src/app/api
git commit -m "refactor(auth): protect data API routes via withAuth wrapper"
```

---

## Task 9: `(app)` route group — sidebar + page-level session enforcement

**Files:**
- Create dir + move: `apps/web/src/app/(app)/`
- Modify: `apps/web/src/app/layout.tsx` (strip to shell)
- Create: `apps/web/src/app/(app)/layout.tsx`
- Create: `apps/web/src/components/logout-button.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx` (add logout)

- [ ] **Step 1: Move existing pages into the route group**

Run (route groups don't change URLs; `@modal` parallel route moves too so interception still works):
```bash
cd apps/web/src/app
mkdir "(app)"
git mv page.tsx "(app)/page.tsx"
git mv photos "(app)/photos"
git mv albums "(app)/albums"
git mv settings "(app)/settings"
git mv upload "(app)/upload"
git mv photo "(app)/photo"
git mv @modal "(app)/@modal"
cd -
```
Expected: `app/(app)/` now contains `page.tsx`, `photos/`, `albums/`, `settings/`, `upload/`, `photo/`, `@modal/`. `app/` still has `api/`, `globals.css`, `icon.svg`, `layout.tsx`.

- [ ] **Step 2: Strip the root layout to a bare shell**

Replace `apps/web/src/app/layout.tsx` with:
```tsx
import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Lumio",
  description: "Your photo library.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fontMono.variable} h-full font-sans antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Create the (app) layout (sidebar + modal + session gate)**

Create `apps/web/src/app/(app)/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { getServerSession } from "@/lib/server-session";

export default async function AppLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <>
      {/* Sidebar is fixed (not in flow); offset content by its 76px width. */}
      <AppSidebar />
      <div className="min-h-dvh pl-[76px]">{children}</div>
      {modal}
    </>
  );
}
```

- [ ] **Step 4: Create the logout button**

Create `apps/web/src/components/logout-button.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      title="Log out"
      onClick={async () => {
        await signOut();
        router.replace("/login");
      }}
      className="group flex w-14 flex-col items-center gap-1 rounded-2xl py-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <LogOut
        className="h-[26px] w-[26px] transition-transform duration-200 group-active:scale-90"
        strokeWidth={1.8}
        aria-hidden
      />
      <span className="text-[10px] leading-none tracking-wide font-medium">
        Logout
      </span>
    </button>
  );
}
```

- [ ] **Step 5: Add the logout button to the sidebar bottom group**

In `apps/web/src/components/app-sidebar.tsx`, add the import after the existing `lucide-react` import line:
```tsx
import { LogoutButton } from "@/components/logout-button";
```
Then, inside the "Bottom group" `<div>`, render it after the SECONDARY map:
```tsx
      {/* Bottom group */}
      <div className="mb-4 flex flex-col items-center gap-1">
        {SECONDARY.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
        <LogoutButton />
      </div>
```

- [ ] **Step 6: Typecheck + run all tests**

Run:
```bash
pnpm --filter @lumio/web exec tsc --noEmit
pnpm -r test
```
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app apps/web/src/components
git commit -m "feat(auth): (app) route group with session gate + logout"
```

---

## Task 10: Login page (shadcn login-02, trimmed)

**Files:**
- Add (CLI): shadcn `login-02` block
- Create/replace: `apps/web/src/components/login-form.tsx`
- Create: `apps/web/src/app/login/page.tsx`

- [ ] **Step 1: Pull the login-02 block for its styling/structure**

Run:
```bash
cd apps/web && npx shadcn@latest add login-02 && cd -
```
Expected: the CLI adds a `login-form` component and a login page somewhere under `src/`, and pulls any missing ui deps. Note where it put them; we overwrite their contents in the next steps and delete any extra page it created (e.g. a `src/app/login-02/` or block demo route) so only `src/app/login/page.tsx` remains.

- [ ] **Step 2: Author the trimmed, wired login form**

Create/replace `apps/web/src/components/login-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";

export function LoginForm({ className }: { className?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error } = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) {
      setError(error.message ?? "Invalid email or password.");
      return;
    }
    router.replace("/photos");
  }

  return (
    <form onSubmit={onSubmit} className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Sign in to your Lumio library.
        </p>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Login"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Author the login page (two-column login-02 shell + setup redirect)**

Create `apps/web/src/app/login/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { Aperture } from "lucide-react";
import { hasAnyUser } from "@lumio/db";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Fresh install with no account yet → go create the admin.
  if (!(await hasAnyUser())) redirect("/setup");

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center gap-2 font-medium">
          <Aperture className="size-5" /> Lumio
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <LoginForm />
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <div className="absolute inset-0 flex items-center justify-center">
          <Aperture className="text-muted-foreground/30 size-40" strokeWidth={1} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors. (If the CLI added a `login-02` demo route that fails to typecheck, delete it.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(auth): login page (login-02 block, trimmed to email+password)"
```

---

## Task 11: Shared auth shell — Logo + Unsplash photo cards

Login and setup share one layout. Extract a reusable `AuthShell` (two columns: brand + form on the left; a muted pane on the right holding a cluster of 3 tilted Unsplash photo cards — rough Instagram-collage inspiration, NOT a full-bleed image). Add a `Logo` component that wraps the Aperture mark and use it wherever the brand icon appears. Refactor the existing login page onto the shell.

**Files:**
- Create: `apps/web/src/components/logo.tsx`
- Create: `apps/web/src/components/auth-photo-stack.tsx`
- Create: `apps/web/src/components/auth-shell.tsx`
- Modify: `apps/web/next.config.ts` (allow the Unsplash image host)
- Modify: `apps/web/src/app/login/page.tsx` (use AuthShell)
- Modify: `apps/web/src/components/app-sidebar.tsx` (use Logo instead of Aperture)

- [ ] **Step 1: Logo component**

Create `apps/web/src/components/logo.tsx`:
```tsx
import { Aperture } from "lucide-react";
import { cn } from "@/lib/utils";

/** The Lumio brand mark. Single source for the logo icon — swap it here later. */
export function Logo({
  className,
  strokeWidth = 1.9,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <Aperture className={cn("size-6", className)} strokeWidth={strokeWidth} aria-hidden />
  );
}
```

- [ ] **Step 2: Photo stack (3 random Unsplash cards)**

Create `apps/web/src/components/auth-photo-stack.tsx` (the 9 ids are verified-live Unsplash CDN photos; no API key needed):
```tsx
import Image from "next/image";
import { cn } from "@/lib/utils";

const PHOTO_IDS = [
  "1506744038136-46273834b3fb",
  "1469474968028-56623f02e42e",
  "1470071459604-3b5ec3a7fe05",
  "1418065460487-3e41a6c84dc5",
  "1501785888041-af3ef285b470",
  "1441974231531-c6227db76b6e",
  "1439066615861-d1af74d74000",
  "1500530855697-b586d89ba3ee",
  "1497436072909-60f360e1d4b1",
];

function src(id: string) {
  return `https://images.unsplash.com/photo-${id}?w=480&h=600&fit=crop&q=80`;
}

/** Pick 3 distinct ids — runs per request on the force-dynamic auth pages. */
function pickThree(): string[] {
  const a = [...PHOTO_IDS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 3);
}

function Card({ id, className }: { id: string; className?: string }) {
  return (
    <div
      className={cn(
        "absolute overflow-hidden rounded-2xl border-4 border-background bg-background shadow-xl",
        className,
      )}
    >
      <Image
        src={src(id)}
        alt=""
        width={200}
        height={250}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

export function AuthPhotoStack() {
  const [back, front, side] = pickThree();
  return (
    <div className="relative h-[440px] w-[360px]" aria-hidden>
      <Card id={back} className="left-3 top-20 h-[260px] w-[190px] -rotate-6" />
      <Card id={side} className="right-3 top-24 h-[250px] w-[185px] rotate-6" />
      <Card
        id={front}
        className="left-1/2 top-8 z-10 h-[300px] w-[215px] -translate-x-1/2 -rotate-1"
      />
    </div>
  );
}
```

- [ ] **Step 3: AuthShell**

Create `apps/web/src/components/auth-shell.tsx`:
```tsx
import { Logo } from "@/components/logo";
import { AuthPhotoStack } from "@/components/auth-photo-stack";

/** Two-column shell shared by /login and /setup: brand + form, with a photo collage. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center gap-2 font-medium">
          <Logo className="size-5" /> Lumio
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="bg-muted relative hidden items-center justify-center overflow-hidden lg:flex">
        <AuthPhotoStack />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Allow the Unsplash image host**

In `apps/web/next.config.ts`, add an `images.remotePatterns` entry alongside the existing config (keep `transpilePackages`, `serverExternalPackages`, and the `webpack` hook unchanged):
```ts
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
```

- [ ] **Step 5: Refactor the login page onto AuthShell**

Replace `apps/web/src/app/login/page.tsx` with:
```tsx
import { redirect } from "next/navigation";
import { hasAnyUser } from "@lumio/db";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Fresh install with no account yet → go create the admin.
  if (!(await hasAnyUser())) redirect("/setup");
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
```

- [ ] **Step 6: Use Logo in the sidebar**

In `apps/web/src/components/app-sidebar.tsx`: remove `Aperture` from the `lucide-react` import, add `import { Logo } from "@/components/logo";`, and replace the brand `<Aperture ... />` with:
```tsx
<Logo className="h-7 w-7 transition-transform duration-500 ease-out hover:rotate-90" />
```
(Drop the now-redundant `strokeWidth`/`aria-hidden` props — `Logo` supplies them.)

- [ ] **Step 7: Verify**

```bash
pnpm --filter @lumio/web exec tsc --noEmit
pnpm --filter @lumio/web build
```
Both must pass (the build validates the `next/image` remote host config). Browser verification of the cards happens in Task 15 (a user must exist for `/login` to render rather than redirect to `/setup`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/next.config.ts apps/web/src/components/logo.tsx apps/web/src/components/auth-photo-stack.tsx apps/web/src/components/auth-shell.tsx "apps/web/src/app/login/page.tsx" apps/web/src/components/app-sidebar.tsx
git commit -m "feat(auth): shared AuthShell with Logo + Unsplash photo cards"
```

---

## Task 12: First-run setup page (uses AuthShell)

**Files:**
- Create: `apps/web/src/components/setup-form.tsx`
- Create: `apps/web/src/app/setup/page.tsx`

- [ ] **Step 1: Author the setup form**

Create `apps/web/src/components/setup-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth-client";

export function SetupForm({ className }: { className?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name"));
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const confirm = String(form.get("confirm"));
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const { error } = await signUp.email({ name, email, password });
      if (error) {
        setError(error.message ?? "Could not create the account.");
        return;
      }
      router.replace("/photos");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Create your admin account</h1>
        <p className="text-muted-foreground text-sm text-balance">
          This is the one-time setup for your Lumio library.
        </p>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" type="text" autoComplete="name" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Author the setup page (closes once a user exists)**

Create `apps/web/src/app/setup/page.tsx` (reuses the shared `AuthShell` from Task 11):
```tsx
import { redirect } from "next/navigation";
import { hasAnyUser } from "@lumio/db";
import { AuthShell } from "@/components/auth-shell";
import { SetupForm } from "@/components/setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // Setup is one-time: once any account exists, send people to login.
  if (await hasAnyUser()) redirect("/login");
  return (
    <AuthShell>
      <SetupForm />
    </AuthShell>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/setup-form.tsx "apps/web/src/app/setup/page.tsx"
git commit -m "feat(auth): first-run setup page to create the admin account"
```

---

## Task 13: Production env + deployment docs

**Files:**
- Modify: `infra/docker-compose.prod.yml` (web service env)
- Modify: `README.md`

- [ ] **Step 1: Add auth env to the prod web service**

In `infra/docker-compose.prod.yml`, under `services.web.environment`, add:
```yaml
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
```
(Place them alongside the existing `PHOTOS_DIR` / `CACHE_DIR` / `PORT` entries.)

- [ ] **Step 2: Document the auth + Cloudflare requirements**

Add a section to `README.md`:
```markdown
## Authentication

Lumio requires login. Set two env vars (compose reads them from your shell or a
root `.env`):

- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`.
- `BETTER_AUTH_URL` — the **public HTTPS origin** the app is served from
  (e.g. `https://photos.example.com`). Behind a Cloudflare tunnel this MUST be
  the external hostname, or session cookies / CSRF checks will fail.

On first launch (no users yet) the app redirects to `/setup` so you can create
the single admin account. After that, account creation is permanently closed
and only `/login` is reachable.

### Cloudflare tunnel
Point your `cloudflared` ingress at the web container:

    ingress:
      - hostname: photos.example.com
        service: http://web:3000
      - service: http_status:404

Then set `BETTER_AUTH_URL=https://photos.example.com`.
```

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.prod.yml README.md
git commit -m "docs(auth): production env vars + Cloudflare tunnel notes"
```

---

## Task 14: Conductor dev workspace — generated secret + port-derived auth URL

**Why:** Conductor runs each workspace's dev server on its own reserved port (`run.sh` sets `PORT=${CONDUCTOR_PORT:-3000}`), but `.env` hardcodes `BETTER_AUTH_URL=http://localhost:3000`. Since `trustedOrigins` is derived from `BETTER_AUTH_URL`, a workspace served on any other port fails sign-in on an origin/CSRF mismatch. Separately, seeding `.env` from `.env.example` leaves the placeholder `BETTER_AUTH_SECRET`. Fix both in the Conductor lifecycle scripts. (Verified: `dotenv-cli` does NOT override an already-exported env var, so exporting `BETTER_AUTH_URL` in `run.sh` wins over `.env`.)

**Files:**
- Modify: `scripts/conductor/setup.sh`
- Modify: `scripts/conductor/run.sh`

- [ ] **Step 1: Generate a real secret at setup**

In `scripts/conductor/setup.sh`, add this AFTER the existing `if [ ! -f .env ] ... fi` block (so it runs whether `.env` was seeded from `.env.example` or copied from the root checkout):
```bash
# Auth: ensure a strong, per-workspace BETTER_AUTH_SECRET. The .env may have come
# from the committed .env.example (placeholder) or a copied root .env; if the
# secret is missing or still a "change-me" placeholder, generate a real one.
if ! grep -qE '^BETTER_AUTH_SECRET=' .env || grep -qE '^BETTER_AUTH_SECRET=.*change-me' .env; then
  secret="$(openssl rand -base64 32)"
  grep -v '^BETTER_AUTH_SECRET=' .env > .env.tmp && mv .env.tmp .env
  printf 'BETTER_AUTH_SECRET="%s"\n' "$secret" >> .env
  echo "setup: generated BETTER_AUTH_SECRET"
fi
```

- [ ] **Step 2: Derive BETTER_AUTH_URL from the workspace port at run time**

In `scripts/conductor/run.sh`, add this immediately AFTER the existing `export PORT="${CONDUCTOR_PORT:-3000}"` line:
```bash
# Better Auth's baseURL / trustedOrigins must match the actual serving origin, or
# sign-in fails the CSRF/origin check. dotenv-cli does NOT override an env var
# that's already exported, so this wins over the .env value and always matches
# the port we're actually serving on (per-workspace in Conductor).
export BETTER_AUTH_URL="http://localhost:${PORT}"
```

- [ ] **Step 3: Verify the logic in isolation (don't clobber the real .env)**

Run:
```bash
# Secret generation: seed a temp .env from the placeholder and confirm it gets replaced.
tmp=$(mktemp -d); cp .env.example "$tmp/.env"
( cd "$tmp"
  if ! grep -qE '^BETTER_AUTH_SECRET=' .env || grep -qE '^BETTER_AUTH_SECRET=.*change-me' .env; then
    secret="$(openssl rand -base64 32)"
    grep -v '^BETTER_AUTH_SECRET=' .env > .env.tmp && mv .env.tmp .env
    printf 'BETTER_AUTH_SECRET="%s"\n' "$secret" >> .env
  fi
  grep '^BETTER_AUTH_SECRET=' .env )
rm -rf "$tmp"
# Expected: one BETTER_AUTH_SECRET line with a ~44-char base64 value, NOT "change-me...".

# URL derivation:
PORT=55220 bash -c 'export BETTER_AUTH_URL="http://localhost:${PORT}"; echo "$BETTER_AUTH_URL"'
# Expected: http://localhost:55220
```

- [ ] **Step 4: Commit**

```bash
git add scripts/conductor/setup.sh scripts/conductor/run.sh
git commit -m "feat(auth): conductor setup generates secret; run derives auth URL from port"
```

---

## Task 15: Full verification + browser walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite, typecheck, lint, and production build**

Run:
```bash
pnpm -r test
pnpm --filter @lumio/web exec tsc --noEmit
pnpm --filter @lumio/web lint
pnpm --filter @lumio/web build
```
Expected: all tests pass; no type errors; lint clean; `next build` succeeds.

- [ ] **Step 2: Browser walkthrough on a fresh DB**

Start fresh so user count is zero. Serve on a known port and point `BETTER_AUTH_URL` at it (mirrors `run.sh`; in a Conductor workspace use `$CONDUCTOR_PORT`):
```bash
pnpm db:up
# If the DB already has a user from earlier manual testing, reset auth rows:
#   pnpm --filter @lumio/db exec prisma migrate reset   # ⚠️ wipes ALL data incl. photos
export PORT="${CONDUCTOR_PORT:-3000}"
export BETTER_AUTH_URL="http://localhost:${PORT}"
pnpm dev
```
Verify in the browser at `http://localhost:$PORT` (substitute the actual port):
1. Visiting `/` while logged out → redirected to `/login` → which (0 users) → redirects to `/setup`. On `/setup` (desktop width) the right pane shows the cluster of 3 tilted Unsplash photo cards; the sidebar/login brand uses the `Logo` component.
2. Create the admin (name + email + password + confirm) → lands in the library (`/photos`), sidebar visible.
3. Open a photo (`/photo/[id]`) → modal interception still works.
4. Click **Logout** in the sidebar → back at `/login` (now shows the login form, since a user exists).
5. Navigate directly to `/setup` → redirected to `/login` (setup is closed).
6. While logged out, `curl http://localhost:$PORT/api/photos` → `401`.
7. Log back in with the admin credentials → library loads.
8. Attempt a second signup (registration closed): `curl -s -X POST http://localhost:$PORT/api/auth/sign-up/email -H 'content-type: application/json' -d '{"name":"x","email":"x@x.com","password":"password123"}'` → `403` with "Registration is closed."

- [ ] **Step 3: Final status note (optional)**

Update `docs/STATUS.md` / memory if the project tracks progress there.

---

## Self-review notes (author)
- **Spec coverage:** auth tables (T1), hasAnyUser (T2), signup gate hook (T3/T4), auth server + env (T4), client + handler (T5), public-path matcher + session helper (T6), proxy request gate (T7), API protection via withAuth (T8), (app) group + sidebar/logout + page gate (T9), login-02 UI (T10), shared AuthShell + Logo + Unsplash photo cards (T11), first-run setup + login↔setup redirects (T10/T12), prod env + Cloudflare docs (T13), Conductor dev env — generated secret + port-derived auth URL (T14), tests/build/browser verify (T15). All spec sections map to a task.
- **Out-of-scope items** (social login, multi-user/invites, password-reset email, Expo, per-user ownership) are intentionally absent.
