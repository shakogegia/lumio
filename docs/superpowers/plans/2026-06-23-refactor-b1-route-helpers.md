# Refactor B1 — API route helpers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four small route helpers (`errorJson`, `parseJson`, `parseQuery`, `mapServiceError`) and adopt them across `apps/web/src/app/api/**`, removing the 19× parse boilerplate, fixing the 17 routes that 500 on malformed JSON, validating the currently-unvalidated routes, and standardizing the error response shape.

**Architecture:** Increment B1 of the Phase B/C refactor (spec: `docs/superpowers/specs/2026-06-23-refactor-phase-bc-design.md`). Behavior-preserving for success paths and status codes; the only contract change is the *shape* of validation-error bodies (now `{ error: string, details? }`), which is safe — **no client parses the current `{ error: flatten }` shape** (verified: the only `.error.issues` reader is a client-side Zod parse in `catalog-service.ts`, unrelated to server responses). Helpers live in `lib/route-helpers.ts` for now; the B5 `lib/` split relocates them to `lib/server/`.

**Tech Stack:** Next.js route handlers (`NextResponse`), Zod, Vitest. Run web tests: `pnpm --filter @lumio/web test`. Workspace gate: `pnpm -r test`.

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `apps/web/src/lib/route-helpers.ts` | **NEW** — the four helpers + `ApiError` type | create |
| `apps/web/src/lib/route-helpers.test.ts` | **NEW** — unit tests | create |
| `apps/web/src/app/api/**/route.ts` | the ~30 route handlers | adopt the helpers |
| `packages/shared/src/*.ts` | Zod schemas | add schemas for the currently-unvalidated routes (profile, features, catalogs) |

---

## Task 1: The route helpers

**Files:**
- Create: `apps/web/src/lib/route-helpers.ts`
- Test: `apps/web/src/lib/route-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/route-helpers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorJson, mapServiceError, parseJson, parseQuery } from "./route-helpers.js";
import { AlbumNotFoundError, SmartAlbumMutationError } from "./albums-service.js";
import { FolderNotFoundError } from "./folders-service.js";

const bodyReq = (raw: string) =>
  new Request("http://x/api", { method: "POST", body: raw, headers: { "content-type": "application/json" } });

describe("errorJson", () => {
  it("emits { error } with the status, and includes details when given", async () => {
    const r = errorJson("nope", 404);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "nope" });
    const r2 = errorJson("bad", 400, { a: 1 });
    expect(await r2.json()).toEqual({ error: "bad", details: { a: 1 } });
  });
});

describe("parseJson", () => {
  const schema = z.object({ name: z.string() });

  it("returns data on a valid body", async () => {
    const r = await parseJson(bodyReq(JSON.stringify({ name: "x" })), schema);
    expect("data" in r && r.data).toEqual({ name: "x" });
  });

  it("returns a 400 response (not throw) on malformed JSON", async () => {
    const r = await parseJson(bodyReq("{not json"), schema);
    expect("response" in r).toBe(true);
    if ("response" in r) expect(r.response.status).toBe(400);
  });

  it("returns a 400 response on schema mismatch", async () => {
    const r = await parseJson(bodyReq(JSON.stringify({ name: 1 })), schema);
    expect("response" in r && r.response.status).toBe(400);
  });
});

describe("parseQuery", () => {
  const schema = z.object({ q: z.string() });
  it("parses searchParams; 400 on mismatch", () => {
    const ok = parseQuery(new Request("http://x/api?q=hi"), schema);
    expect("data" in ok && ok.data).toEqual({ q: "hi" });
    const bad = parseQuery(new Request("http://x/api"), schema);
    expect("response" in bad && bad.response.status).toBe(400);
  });
});

describe("mapServiceError", () => {
  it("maps known typed errors to status codes, returns null for unknown", () => {
    expect(mapServiceError(new AlbumNotFoundError("x"))?.status).toBe(404);
    expect(mapServiceError(new FolderNotFoundError("x"))?.status).toBe(404);
    expect(mapServiceError(new SmartAlbumMutationError("x"))?.status).toBe(400);
    expect(mapServiceError(new Error("generic"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/web test -- route-helpers`
Expected: FAIL — `./route-helpers.js` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/src/lib/route-helpers.ts`:
```ts
import { NextResponse } from "next/server";
import type { z } from "zod";
import { FeatureScopeError, UnknownFeatureError } from "@lumio/db";
import { AlbumNotFoundError, PhotoNotInAlbumError, SmartAlbumMutationError } from "@/lib/albums-service";
import { FolderCycleError, FolderNotFoundError } from "@/lib/folders-service";

/** The single error-response shape for every API route. */
export interface ApiError {
  error: string;
  details?: unknown;
}

/** Build a JSON error response with the standard shape. */
export function errorJson(message: string, status: number, details?: unknown): NextResponse<ApiError> {
  return NextResponse.json(
    details === undefined ? { error: message } : { error: message, details },
    { status },
  );
}

/** Either the parsed data, or a ready-to-return 400 response. */
export type ParseResult<T> = { data: T } | { response: NextResponse<ApiError> };

/** Parse + validate a JSON request body. Never throws on malformed JSON (→ 400). */
export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<ParseResult<T>> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: errorJson("Invalid request body", 400, parsed.error.flatten()) };
  return { data: parsed.data };
}

/** Parse + validate the query string (flat params). For repeated params, parse manually. */
export function parseQuery<T>(request: Request, schema: z.ZodType<T>): ParseResult<T> {
  const params = new URL(request.url).searchParams;
  const parsed = schema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return { response: errorJson("Invalid query parameters", 400, parsed.error.flatten()) };
  return { data: parsed.data };
}

// The typed domain errors a service may throw, and the HTTP status each maps to.
const ERROR_STATUS: ReadonlyArray<readonly [abstract new (...args: never[]) => Error, number]> = [
  [AlbumNotFoundError, 404],
  [PhotoNotInAlbumError, 404],
  [FolderNotFoundError, 404],
  [SmartAlbumMutationError, 400],
  [FolderCycleError, 400],
  [FeatureScopeError, 400],
  [UnknownFeatureError, 400],
];

/** Map a thrown service error to a response, or null to signal "rethrow" (unknown). */
export function mapServiceError(err: unknown): NextResponse<ApiError> | null {
  for (const [Cls, status] of ERROR_STATUS) {
    if (err instanceof Cls) return errorJson(err.message || Cls.name, status);
  }
  return null;
}
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `pnpm --filter @lumio/web test -- route-helpers`
Expected: PASS (all groups).
Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no new errors (pre-existing `@lumio/shared/calendar.ts` error is unrelated/out of scope).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/route-helpers.ts apps/web/src/lib/route-helpers.test.ts
git commit -m "web: add API route helpers (parseJson/parseQuery/errorJson/mapServiceError)"
```

---

## Task 2: Adopt the helpers across all routes

Mechanical conversion of every `app/api/**/route.ts`. Not TDD — behavior-preserving refactor verified by the existing suite + grep gates. Work through the routes by the four patterns below; for each unvalidated route, add a Zod schema to `@lumio/shared` matching the shape the route currently assumes, then validate via `parseJson`.

**Files:**
- Modify: `apps/web/src/app/api/**/route.ts` (every route with the boilerplate)
- Modify: `packages/shared/src/*.ts` (add `updateProfileSchema`, `featureToggleSchema`, catalog create/rename schemas — derive each from the route's current cast/hand-validation)

- [ ] **Step 1: Convert the `safeParse`-body pattern → `parseJson`**

Exemplar — `apps/web/src/app/api/c/[catalog]/photos/color-label/route.ts`. Before:
```ts
export const POST = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  const parsed = setColorLabelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const count = await setPhotoColorLabel(catalog.id, parsed.data.photoIds, parsed.data.label);
  return NextResponse.json({ status: "labeled", count });
});
```
After:
```ts
import { parseJson } from "@/lib/route-helpers";
// ...
export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, setColorLabelSchema);
  if ("response" in parsed) return parsed.response;
  const { photoIds, label } = parsed.data;
  const count = await setPhotoColorLabel(catalog.id, photoIds, label);
  return NextResponse.json({ status: "labeled", count });
});
```
Apply to every route matching `grep -rl "parsed.error.flatten()" apps/web/src/app/api`. (This also fixes the unguarded `request.json()` for these.)

- [ ] **Step 2: Convert the query-param pattern → `parseQuery`**

For routes that do `Object.fromEntries(searchParams)` + `safeParse` (e.g. `photos/route.ts`, `trash/route.ts`, `folders/[id]/photos/route.ts`, `albums/[id]/photos/route.ts`), use `parseQuery`. **Exception — the two search routes** (`search/route.ts`, `search/calendar/route.ts`) carry the `album: searchParams.getAll("album")` repeated-param case; keep their manual `Object.fromEntries(...) + album: getAll(...)` parse but route the failure through `errorJson("Invalid query parameters", 400, parsed.error.flatten())` (do NOT force them through `parseQuery`, which can't see repeated params).

- [ ] **Step 3: Validate the currently-unvalidated routes**

`apps/web/src/app/api/profile/route.ts` PUT currently does `(await request.json()) as { soundEffectsEnabled?: boolean }` — no validation. Add to `packages/shared` (e.g. a new `profile.ts` or in an existing module):
```ts
export const updateProfileSchema = z.object({ soundEffectsEnabled: z.boolean().optional() });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
```
and convert:
```ts
export const PUT = withAuth(async (request, _context, session) => {
  const parsed = await parseJson(request, updateProfileSchema);
  if ("response" in parsed) return parsed.response;
  return NextResponse.json(await updateProfile(session.user.id, parsed.data));
});
```
Do the same for `features/route.ts` (read its current hand-rolled enum + `typeof` checks; replace with a `featureToggleSchema = z.object({ key: z.nativeEnum(FeatureKey), catalogId: z.string().min(1).nullable(), enabled: z.boolean() })`) and the top-level `catalogs` routes (`catalogs/route.ts` POST `{name, path}`, `catalogs/[id]/route.ts` PATCH `{name?, afterId?}` — derive the exact shapes by reading each route + `catalog-service.ts`'s `createCatalogChecked`, and move that validation up to the route via `parseJson`).

- [ ] **Step 4: Standardize error responses + adopt `mapServiceError`**

Convert the 3 plain-text FS routes (`fs/browse/route.ts`, `fs/calendar/route.ts`, `fs/photos/route.ts`) from `new Response("Invalid path", { status: 400 })` to `errorJson("Invalid path", 400)`. In the routes with an `instanceof`-ladder (`folders/route.ts`, `folders/move/route.ts`, `folders/[id]/route.ts`, `albums/[id]/route.ts`, `albums/[id]/photos/route.ts`), replace the ladder with:
```ts
try {
  // ... service call ...
} catch (err) {
  const mapped = mapServiceError(err);
  if (mapped) return mapped;
  throw err;
}
```

- [ ] **Step 5: Verify the gates**

```bash
cd /Users/gego/conductor/workspaces/lumio/berlin-v3
# No route still hand-rolls the flatten 400 (all go through the helpers):
grep -rn "parsed.error.flatten()" apps/web/src/app/api ; echo "^ expect: none"
# No unguarded request.json() left in routes (all via parseJson, which catches):
grep -rln "request.json()" apps/web/src/app/api | xargs grep -L "parseJson" ; echo "^ expect: none (or only routes that legitimately read a non-JSON body)"
# No plain-text error Response in app/api:
grep -rn 'new Response("' apps/web/src/app/api | grep -iE "400|404|status" ; echo "^ expect: none"
```
Run: `pnpm -r test` → all packages green (the existing route tests assert the success paths + status codes are unchanged).
Run: `pnpm --filter @lumio/web exec tsc --noEmit` and `cd apps/web && pnpm exec eslint src/app/api` → clean (pre-existing `calendar.ts` aside).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "web: adopt route helpers across api/** (validate, no 500 on bad JSON, one error shape)"
```

---

## Self-review

- **Spec coverage (B1 slice):** parse boilerplate dedup → Task 2 Step 1-2 ✓; malformed-JSON 500 fix → `parseJson`'s `.catch` ✓; missing validation (profile/features/catalogs) → Step 3 ✓; error-shape standardization + 3 FS routes → `errorJson` + Step 4 ✓; typed-error mapping → `mapServiceError` + Step 4 ✓. The B1 caveat (no client reads the flatten shape) was verified before planning.
- **Placeholder scan:** Task 1 is fully concrete. Task 2 is intentionally a pattern-driven sweep (exemplars + grep gates) rather than 30 hand-written diffs — the implementer derives each unvalidated schema from the route's current shape (Step 3 names the exact files + the known fields). No vague "add validation" without the schema shape.
- **Type consistency:** `ParseResult<T>` discriminated `{ data } | { response }` is used identically in `parseJson`/`parseQuery` and every adoption site (`if ("response" in parsed) return parsed.response;`). `errorJson(message, status, details?)` signature consistent across helpers and routes. `mapServiceError` returns `NextResponse<ApiError> | null`; the `?? throw` adoption matches.
