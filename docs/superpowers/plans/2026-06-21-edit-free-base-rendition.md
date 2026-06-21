# Edit-free Base + Separate Edited Rendition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the display rendition as a permanent edit-free base, write a separate `edited.webp` on Apply, have the editor read the static base (no decode on Edit-tab open), and retire the on-demand `/edit-base` endpoint.

**Architecture:** `displayPath` becomes the never-overwritten edit-free base; `editedDisplayPath` holds the baked display; the thumbnail stays the single always-current file. Apply and the worker regenerate write the base + edited split; views pick edited-or-base via `displayUrl`; the editor canvas uses `baseDisplayUrl` and crisp zoom reuses `/original`.

**Tech Stack:** Next.js App Router, sharp, React (React Compiler — `"use client"` line 1), Vitest. Reference spec: `docs/superpowers/specs/2026-06-21-edit-free-base-rendition-design.md`.

**Verify:** web → `pnpm --filter @lumio/web lint`; ingest → `pnpm --filter @lumio/ingest test`; full → `pnpm -r test`. Known pre-existing lint errors to ignore: `use-activity.ts`, `use-async-job.ts`, `library-tree.tsx`/`use-rename-folder-dialog.tsx`, `add-to-album-dialog.tsx`. Browser-verify is a final pass.

---

## Task 1: Paths + URL helpers

**Files:** `apps/web/src/lib/paths.ts`, `apps/web/src/lib/rendition-url.ts`

- [ ] **Step 1: `editedDisplayPath`** — in `paths.ts`, add after `displayPath`:
```ts
export function editedDisplayPath(id: string): string {
  return path.join(CACHE_DIR, "displays-edited", `${id}.webp`);
}
```

- [ ] **Step 2: URL helpers** — in `rendition-url.ts`, add the `hasEdits` import and update/add:
```ts
import { hasEdits, type PhotoDTO } from "@lumio/shared";
// ...
/** Display rendition for VIEWS: the baked `edited.webp` when the photo has edits,
 *  else the edit-free base. The base never changes, so it needs no cache-bust. */
export function displayUrl(photo: Pick<PhotoDTO, "id" | "updatedAt" | "edits">): string {
  return hasEdits(photo.edits)
    ? `/api/photos/${photo.id}/display?edited=1&v=${renditionVersion(photo.updatedAt)}`
    : `/api/photos/${photo.id}/display`;
}

/** Edit-free base display — the editor canvas source (static, no decode). */
export function baseDisplayUrl(photo: Pick<PhotoDTO, "id">): string {
  return `/api/photos/${photo.id}/display`;
}
```
(Replace the old `displayUrl`. `renditionVersion`/`thumbUrl` unchanged.)

- [ ] **Step 3: Fix `displayUrl` callers** — run `grep -rn "displayUrl" apps/web/src --include=*.tsx --include=*.ts | grep -v rendition-url`. Each caller must pass an object with `edits` (most pass a full `PhotoDTO`, which already has it). If any passes a narrower `Pick` without `edits`, widen it. Confirm with `pnpm --filter @lumio/web lint`.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/lib/paths.ts apps/web/src/lib/rendition-url.ts
git commit -m "feat(web): editedDisplayPath + displayUrl edited-or-base + baseDisplayUrl"
```

---

## Task 2: Apply service writes the edited variant (not the base)

**Files:** `apps/web/src/lib/photo-edits-service.ts`

- [ ] **Step 1: Read** `photo-edits-service.ts`. Current `applyPhotoEdits` builds renditions and writes both `displayPath(id)` and `thumbnailPath(id)`, then updates the row.

- [ ] **Step 2: Rewrite the write logic.** Replace the body between `buildRenditions(...)` and the `prisma.photo.update(...)` so it (a) never writes `displayPath` (the base is owned by ingest and stays edit-free), (b) writes the thumb (always current), (c) writes `editedDisplayPath` only when edited, deleting it on reset. Update the imports: add `rm` to the `node:fs/promises` import and `editedDisplayPath` to the `@/lib/paths` import.
```ts
    const { display, thumbnail, thumbhash, width, height } = await buildRenditions(
      decoded.input,
      recipe,
    );
    // The base display (displayPath) is written once at ingest and stays edit-free
    // — never rewritten here. The thumbnail is always the current state.
    await mkdir(path.dirname(thumbnailPath(id)), { recursive: true });
    await writeFile(thumbnailPath(id), thumbnail);
    if (recipe) {
      await mkdir(path.dirname(editedDisplayPath(id)), { recursive: true });
      await writeFile(editedDisplayPath(id), display); // baked, separate from the base
    } else {
      await rm(editedDisplayPath(id), { force: true }); // reset → drop the edited variant
    }

    const updated = await prisma.photo.update({
      where: { id },
      data: {
        edits: recipe ? (recipe as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        width,
        height,
        thumbhash,
      },
    });
    return toPhotoDTO(updated);
```
(`buildRenditions(input, null)` for the reset case returns the base thumb + base dims, which is exactly what we want as the current state.)

- [ ] **Step 3: Update the existing test if present.** Run `pnpm --filter @lumio/web test photo-edits-service 2>/dev/null` or check for `photo-edits-service.test.ts`. If a test asserts `displayPath` is written on apply, change it to assert `editedDisplayPath` is written and `displayPath` is untouched; if a test asserts reset, assert `editedDisplayPath` is removed. If there is no such test, skip (covered by browser-verify).

- [ ] **Step 4: Verify** `pnpm --filter @lumio/web lint` (file clean) + any web test green.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/lib/photo-edits-service.ts
git commit -m "feat(web): Apply writes edited.webp, leaving the display base edit-free"
```

---

## Task 3: Display route serves the edited variant on `?edited=1`

**Files:** `apps/web/src/app/api/photos/[id]/display/route.ts`

- [ ] **Step 1: Rewrite the route** to branch on `?edited=1`, falling back to the base if the edited file is missing. Import `editedDisplayPath`; rename `_request` → `request`:
```ts
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { displayPath, editedDisplayPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const wantEdited = new URL(request.url).searchParams.get("edited");
    const webp = (file: Buffer) =>
      new NextResponse(new Uint8Array(file), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    try {
      if (wantEdited) {
        try {
          return webp(await readFile(editedDisplayPath(id)));
        } catch {
          // edited variant missing → fall back to the base
        }
      }
      return webp(await readFile(displayPath(id)));
    } catch {
      return NextResponse.json({ error: "Display rendition not found" }, { status: 404 });
    }
  },
);
```

- [ ] **Step 2: Verify** `pnpm --filter @lumio/web lint` (route clean).

- [ ] **Step 3: Commit**
```bash
git add "apps/web/src/app/api/photos/[id]/display/route.ts"
git commit -m "feat(web): display route serves edited.webp on ?edited=1 (base fallback)"
```

---

## Task 4: Retire `/edit-base`; point the editor at the base + `/original`

**Files:** `packages/ingest/src/renditions.ts` (+ test), delete `apps/web/src/app/api/photos/[id]/edit-base/route.ts`, `apps/web/src/components/photo-grid/zoomable-image.tsx`

- [ ] **Step 1: Remove `buildEditBase` + `buildEditBaseFull`** from `packages/ingest/src/renditions.ts` (the two exported functions near the end). Remove their tests from `packages/ingest/src/renditions.test.ts` (the `describe("buildEditBase", …)` and `describe("buildEditBaseFull", …)` blocks, and drop `buildEditBase`/`buildEditBaseFull` from that file's import). Run `pnpm --filter @lumio/ingest test` → green.

- [ ] **Step 2: Delete the route file**
```bash
git rm "apps/web/src/app/api/photos/[id]/edit-base/route.ts"
```

- [ ] **Step 3: Rewire `zoomable-image.tsx`.** Add `baseDisplayUrl` to the `@/lib/rendition-url` import (alongside `displayUrl`, `renditionVersion`). Remove the two lines:
```ts
  const editBaseSrc = `/api/photos/${photo.id}/edit-base`;
  const editBaseFullSrc = `/api/photos/${photo.id}/edit-base?full=1`;
```
and add:
```ts
  const baseSrc = baseDisplayUrl(photo);
```
Update the three usages:
- `<EditorCanvas src={editBaseSrc} …/>` → `<EditorCanvas src={baseSrc} …/>`
- `<EditedResult src={editBaseSrc} fullSrc={editBaseFullSrc} …/>` → `<EditedResult src={baseSrc} fullSrc={originalSrc} …/>`
(`originalSrc = \`/api/photos/${photo.id}/original\`` is already defined in the file. The non-editing `hiResSrc`/`displayUrl` usages stay as-is — `displayUrl(photo)` now returns edited-or-base automatically.)

- [ ] **Step 4: Verify** `pnpm --filter @lumio/web lint` (zoomable-image clean; no remaining `edit-base`/`editBaseSrc`/`editBaseFullSrc` references — `grep -rn "edit-base\|editBaseSrc\|editBaseFullSrc\|buildEditBase" apps/web/src packages/ingest/src` returns nothing) and `pnpm --filter @lumio/ingest test` green.

- [ ] **Step 5: Commit**
```bash
git add packages/ingest/src/renditions.ts packages/ingest/src/renditions.test.ts apps/web/src/components/photo-grid/zoomable-image.tsx
git commit -m "feat: retire /edit-base; editor reads the base display + /original for zoom"
```

---

## Task 5: Worker re-ingest writes the base + edited split

**Files:** `packages/ingest/src/regenerate.ts` (+ test if present), `packages/ingest/src/ingest.ts`, `apps/worker/src/deps.ts`, `apps/worker/src/scan.ts`; check `apps/web/src/lib/upload-service.ts` + `apps/web/src/app/api/uploads/route.ts`

- [ ] **Step 1: `RegenerateDeps` + split logic** in `packages/ingest/src/regenerate.ts`. Add `editedDisplaysDir` to `RegenerateDeps` and `rm` to the `node:fs/promises` import. Replace the body of `regenerateRenditions`:
```ts
  const decoded = await decodeToSharpInput(absPath);
  try {
    // The base display is always edit-free.
    const base = await buildRenditions(decoded.input, null);
    await mkdir(deps.displaysDir, { recursive: true });
    await mkdir(deps.thumbnailsDir, { recursive: true });
    await writeFile(path.join(deps.displaysDir, `${id}.webp`), base.display);
    if (edits) {
      const edited = await buildRenditions(decoded.input, edits);
      await mkdir(deps.editedDisplaysDir, { recursive: true });
      await writeFile(path.join(deps.editedDisplaysDir, `${id}.webp`), edited.display);
      await writeFile(path.join(deps.thumbnailsDir, `${id}.webp`), edited.thumbnail);
      return { thumbhash: edited.thumbhash, width: edited.width, height: edited.height };
    }
    await writeFile(path.join(deps.thumbnailsDir, `${id}.webp`), base.thumbnail);
    await rm(path.join(deps.editedDisplaysDir, `${id}.webp`), { force: true });
    return { thumbhash: base.thumbhash, width: base.width, height: base.height };
  } finally {
    await decoded.cleanup();
  }
```

- [ ] **Step 2: Thread `editedDisplaysDir` through the worker.** In `apps/worker/src/deps.ts`, define `EDITED_DISPLAYS_DIR = path.join(CACHE_DIR, "displays-edited")` (mirror how `DISPLAYS_DIR` is defined) and add `editedDisplaysDir: EDITED_DISPLAYS_DIR` to the deps object(s) passed to `regenerateRenditions` (the one used by `scan.ts`). `scan.ts:109` passes `ingestDeps` — ensure that object now carries `editedDisplaysDir`. (If `ingestDeps` is also used by `storePhoto`/ingest which doesn't take it, that's fine — extra field is ignored.)

- [ ] **Step 3: Remove the edited variant on delete.** In `packages/ingest/src/ingest.ts` where a removed photo's renditions are deleted (the `rm(path.join(deps.displaysDir, …))` line), add a sibling `rm(path.join(deps.editedDisplaysDir, \`${found.id}.webp\`), { force: true })` and add `editedDisplaysDir` to that function's deps type. Thread it from the worker delete deps in `deps.ts`. (If wiring this cleanly balloons scope, instead leave a `// TODO` is NOT allowed — if it's more than ~3 files, stop and report DONE_WITH_CONCERNS describing the delete-cleanup wiring so the controller can decide.)

- [ ] **Step 4: Uploads path.** Read `apps/web/src/lib/upload-service.ts` and `apps/web/src/app/api/uploads/route.ts`. If they call `regenerateRenditions`, add `editedDisplaysDir: path.join(CACHE_DIR, "displays-edited")` to the deps they build. If they only call `storePhoto`/ingest (new uploads have no edits → base only), no change needed. Confirm by reading.

- [ ] **Step 5: Update/adjust regenerate test if present** (`packages/ingest/src/regenerate.test.ts`): assert that for an edited recipe the base display is edit-free and a separate edited display is written; for null edits, only base + base thumb and the edited file is absent. If no test exists, add a minimal one using a small fixture (write to temp dirs, check the two files differ for an edited recipe).

- [ ] **Step 6: Verify** `pnpm --filter @lumio/ingest test` green; `pnpm --filter @lumio/web lint` clean; `pnpm --filter @lumio/worker test` green (worker deps still typecheck).

- [ ] **Step 7: Commit**
```bash
git add packages/ingest/src/regenerate.ts packages/ingest/src/ingest.ts apps/worker/src/deps.ts apps/worker/src/scan.ts apps/web/src/lib/upload-service.ts "apps/web/src/app/api/uploads/route.ts" packages/ingest/src/regenerate.test.ts
git commit -m "feat(ingest): re-ingest writes edit-free base + separate edited rendition"
```

---

## Task 6: Verification + finish

**Files:** none.

- [ ] **Step 1: Sweep** `pnpm -r test` (all green); `pnpm --filter @lumio/web lint` (only known pre-existing errors). `grep -rn "edit-base\|buildEditBase\|editBaseSrc\|editBaseFullSrc" apps/web/src packages` → no results.

- [ ] **Step 2: Browser-verify** (mini-PC focus, against the dev server):
  - Open Edit on an **unedited JXL** → instant (static base, no decode); the canvas shows the photo immediately.
  - Pick a crop → Apply → grid tile + lightbox show the cropped result (`edited.webp`); the base file on disk (`cache/displays/<id>.webp`) is unchanged.
  - Re-open Edit on that now-edited photo → still instant (reads the base), crop is editable/expandable.
  - Reset → back to original everywhere; the `edited.webp` is gone.
  - Editor zoom: sharpens for JPEG, stays soft for JXL (no crash).
  - Non-editing zoom of an edited photo shows the edited image.

- [ ] **Step 3: Migration check** — for a photo edited **before** this change (display baked under old code), run the worker rescan/regenerate once and confirm it now edits correctly (no double-applied recipe). Document in the PR that a one-time rescan is required for previously-edited photos.

- [ ] **Step 4: Finish** — use superpowers:finishing-a-development-branch (the branch already has an open PR; push the new commits — the PR updates automatically).

---

## Self-review (coverage)
- Spec §3 (paths) → T1. §4 (remove edit-base fns) → T4. §5 (Apply) → T2. §6 (routes: display ?edited / delete edit-base) → T3/T4. §7 (URL helpers) → T1. §8 (editor wiring) → T4. §9 (regenerate split) → T5. §10 (migration) → T6 §3. §12 (testing) → T2/T5 + T6.
- Type consistency: `editedDisplayPath` (T1) used in T2/T3; `baseDisplayUrl`/`displayUrl` (T1) used in T4; `RegenerateDeps.editedDisplaysDir` (T5) threaded via deps.ts/scan.ts.
- No placeholders; complete code per step. (T5 Step 3 flags the delete-cleanup wiring as a stop-point if it exceeds ~3 files, rather than leaving a TODO.)
