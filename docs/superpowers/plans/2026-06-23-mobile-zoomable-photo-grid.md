# Mobile Zoomable Photo Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile Photos-tab placeholder with the active catalog's real photos in an iOS-Photos-style, pinch-to-zoom grid with infinite scroll, built from reusable pieces.

**Architecture:** Three decoupled, reusable layers — a `fetch`-based data client (`photos-api.ts`), a source-agnostic pagination hook (`usePhotoPages`), and presentational components (`PhotoTile` + `ZoomablePhotoGrid` on FlashList + a pinch gesture). The iOS large-title scroll-edge header is extracted from `LargeHeaderScreen` so it can sit over a FlashList. Albums can later reuse the hook + grid by swapping only the fetcher.

**Tech Stack:** Expo SDK 56, React Native 0.85, TypeScript, `@shopify/flash-list` (new), `react-native-gesture-handler` (present), `expo-image` (present, decodes ThumbHash + sends auth header), `expo-secure-store` (zoom persistence), vitest (pure-helper tests).

**Conventions (match existing code):**
- Mobile depends on `@lumio/shared` (`workspace:*`) and imports it **type-only** (`import type { … }`). The package exposes a single barrel (`export *` from ~20 modules), so a *value* import would bundle the whole shared graph into the RN app — some modules use Node-only APIs that break under Hermes (the class of bug the better-auth shim in `metro.config.js` guards against). Type imports are erased at build time: zero runtime bundle, zero Hermes risk, and Metro/vitest never resolve them — they just give us the real API-contract types (`PhotoDTO`, `PhotosPage`). The grid needs only types.
- Custom API calls authenticate with the `Cookie` header from `useAuth().getCookie()`.
- `setState` only inside deferred promise callbacks in effects (React-Compiler-lint safe), as in `catalog-context.tsx`.
- Path alias `@/*` → `apps/mobile/src/*` (used in app/Metro; **not** configured for vitest, so test files use relative imports and pure-logic modules avoid value imports of `@/`).

---

## Task 1: Dependencies & root wiring

**Files:**
- Modify: `apps/mobile/package.json` (add `@lumio/shared` + FlashList)
- Modify: `apps/mobile/src/app/_layout.tsx`
- Modify: `apps/mobile/vitest.config.ts`

- [ ] **Step 1: Add the `@lumio/shared` workspace dependency**

Edit `apps/mobile/package.json` — add to `dependencies` (alphabetical, before `@react-native-masked-view/...`):

```json
    "@lumio/shared": "workspace:*",
```

Then link it from the repo root:
```bash
pnpm install
```
Expected: `apps/mobile/node_modules/@lumio/shared` (or root `node_modules/@lumio/shared`) becomes a symlink to `packages/shared`. (`@lumio/shared` ships its TS source directly — `"main": "./src/index.ts"`, no build step — and its only runtime deps are `zod` + `fractional-indexing`, both RN-safe.)

- [ ] **Step 2: Install FlashList**

Run (from repo root):
```bash
cd apps/mobile && npx expo install @shopify/flash-list && cd -
```
Expected: `@shopify/flash-list` added to `apps/mobile/package.json` `dependencies` at an SDK-56-compatible version; root `pnpm-lock.yaml` updated. (If it reports a peer-dep issue, accept the version `expo install` selects — it resolves to the SDK-compatible release.)

- [ ] **Step 3: Verify `@lumio/shared` resolves**

Run:
```bash
ls apps/mobile/node_modules/@lumio/shared 2>/dev/null || ls node_modules/@lumio/shared
```
Expected: lists the package (the symlinked `packages/shared` contents, e.g. `package.json`, `src`). If neither path exists, re-run `pnpm install`.

- [ ] **Step 4: Mount `GestureHandlerRootView` at the app root**

The pinch gesture requires this wrapper; it is currently missing. Replace `apps/mobile/src/app/_layout.tsx` with:

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/contexts/auth-context";
import { AnimatedSplash } from "@/components/animated-splash";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          {/* `auto` flips status-bar text to match the system light/dark scheme. */}
          <StatusBar style="auto" />
          {/* Native default transition for in-app navigation. The launch reveal is
              a fade owned by <AnimatedSplash/>, which also covers the initial
              redirect (index → connect/login) so its slide isn't seen on entry. */}
          <Stack screenOptions={{ headerShown: false }} />
          <AnimatedSplash />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 5: Broaden the vitest test glob**

Tests live next to their modules (not only under `src/lib`). Replace `apps/mobile/vitest.config.ts` with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 6: Verify the existing test suite still runs**

Run:
```bash
pnpm --filter @lumio/mobile test
```
Expected: PASS (the existing `normalizeServerUrl` tests under `src/lib` still pass with the broadened glob).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/package.json apps/mobile/src/app/_layout.tsx apps/mobile/vitest.config.ts pnpm-lock.yaml
git commit -m "feat(mobile): add @lumio/shared + FlashList deps, GestureHandlerRootView root, broaden vitest glob"
```

---

## Task 2: Photos API client (`photos-api.ts`)

**Files:**
- Create: `apps/mobile/src/lib/photos-api.ts`
- Test: `apps/mobile/src/lib/photos-api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/photos-api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchPhotos, thumbnailUrl } from "./photos-api";

describe("fetchPhotos", () => {
  it("requests the catalog photos endpoint with limit/offset and the cookie", async () => {
    const json = vi
      .fn()
      .mockResolvedValue({ items: [{ id: "p1", updatedAt: "t", thumbhash: null }], total: 1 });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json });
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchPhotos("http://h", "cat", "session=x", { limit: 50, offset: 100 });

    expect(fetchMock).toHaveBeenCalledWith("http://h/api/c/cat/photos?limit=50&offset=100", {
      headers: { accept: "application/json", Cookie: "session=x" },
    });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe("p1");
  });

  it("throws a reach error when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    await expect(
      fetchPhotos("http://h", "cat", "c", { limit: 1, offset: 0 }),
    ).rejects.toThrow("Couldn't reach the server.");
  });

  it("throws a status error on non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(
      fetchPhotos("http://h", "cat", "c", { limit: 1, offset: 0 }),
    ).rejects.toThrow("Couldn't load photos (500).");
  });
});

describe("thumbnailUrl", () => {
  it("builds a versioned thumbnail URL", () => {
    const updatedAt = "2026-06-23T00:00:00.000Z";
    expect(thumbnailUrl("http://h", "cat", { id: "p1", updatedAt })).toBe(
      `http://h/api/c/cat/photos/p1/thumbnail?v=${Date.parse(updatedAt)}`,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/mobile test`
Expected: FAIL — cannot resolve `./photos-api`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/photos-api.ts`:

```ts
// Minimal client for the server's per-catalog photo endpoints. Auth is the
// Better Auth session cookie (from the Expo client's getCookie()), same as
// catalog-api.ts. Photo/page shapes are the real API contract from
// @lumio/shared, imported TYPE-ONLY so nothing from the shared barrel is bundled
// into the RN app (see the conventions note at the top of this plan).

import type { PhotoDTO, PhotosPage } from "@lumio/shared";

/** One page of the active catalog's photos (server default sort = newest
 *  imported first). Offset-paginated; `limit` is capped at 100 by the server. */
export async function fetchPhotos(
  baseURL: string,
  slug: string,
  cookie: string,
  opts: { limit: number; offset: number },
): Promise<PhotosPage> {
  const query = new URLSearchParams({
    limit: String(opts.limit),
    offset: String(opts.offset),
  });
  let res: Response;
  try {
    res = await fetch(`${baseURL}/api/c/${slug}/photos?${query}`, {
      headers: { accept: "application/json", Cookie: cookie },
    });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (!res.ok) {
    throw new Error(`Couldn't load photos (${res.status}).`);
  }
  return (await res.json()) as PhotosPage;
}

/** Authenticated WebP thumbnail URL for a photo. Cache-busted by updatedAt so an
 *  applied edit re-fetches — same convention as the web app's rendition-url. */
export function thumbnailUrl(
  baseURL: string,
  slug: string,
  photo: Pick<PhotoDTO, "id" | "updatedAt">,
): string {
  return `${baseURL}/api/c/${slug}/photos/${photo.id}/thumbnail?v=${Date.parse(photo.updatedAt)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/mobile test`
Expected: PASS (all `fetchPhotos` + `thumbnailUrl` cases).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/photos-api.ts apps/mobile/src/lib/photos-api.test.ts
git commit -m "feat(mobile): photos-api client (fetchPhotos + thumbnailUrl)"
```

---

## Task 3: Pure pagination helpers (`photo-pages.ts`)

**Files:**
- Create: `apps/mobile/src/lib/photo-pages.ts`
- Test: `apps/mobile/src/lib/photo-pages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/photo-pages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeById, hasMore } from "./photo-pages";

describe("mergeById", () => {
  it("returns incoming when prev is empty", () => {
    expect(mergeById([], [{ id: "a" }])).toEqual([{ id: "a" }]);
  });
  it("appends new items", () => {
    expect(mergeById([{ id: "a" }], [{ id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
  });
  it("drops duplicates by id", () => {
    expect(mergeById([{ id: "a" }], [{ id: "a" }, { id: "b" }])).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });
});

describe("hasMore", () => {
  it("is true when loaded < total", () => expect(hasMore(50, 100)).toBe(true));
  it("is false when loaded === total", () => expect(hasMore(100, 100)).toBe(false));
  it("is false when loaded > total", () => expect(hasMore(120, 100)).toBe(false));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/mobile test`
Expected: FAIL — cannot resolve `./photo-pages`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/photo-pages.ts`:

```ts
// Pure pagination helpers for usePhotoPages. Kept React-free so they're trivially
// unit-testable; the hook composes them.

/** Append `incoming` to `prev`, dropping any whose id is already present (keeps
 *  the grid stable if the server returns an overlapping page). */
export function mergeById<T extends { id: string }>(prev: T[], incoming: T[]): T[] {
  if (prev.length === 0) return incoming;
  const seen = new Set(prev.map((x) => x.id));
  return [...prev, ...incoming.filter((x) => !seen.has(x.id))];
}

/** Whether more pages remain (fewer loaded than the reported total). */
export function hasMore(loaded: number, total: number): boolean {
  return loaded < total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/mobile test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/photo-pages.ts apps/mobile/src/lib/photo-pages.test.ts
git commit -m "feat(mobile): pure pagination helpers (mergeById, hasMore)"
```

---

## Task 4: Pagination hook (`usePhotoPages`)

**Files:**
- Create: `apps/mobile/src/hooks/use-photo-pages.ts`

No unit test (a hook needs a renderer; its logic lives in the Task 3 pure helpers). Verified by lint/typecheck + manual run.

- [ ] **Step 1: Write the hook**

Create `apps/mobile/src/hooks/use-photo-pages.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";
import { hasMore, mergeById } from "@/lib/photo-pages";

/** A page fetcher bound to a data source (catalog, album, …). `null` means the
 *  source isn't ready yet (no server/catalog) — the hook stays idle. */
export type FetchPage = ((offset: number, limit: number) => Promise<PhotosPage>) | null;

/**
 * Source-agnostic infinite-scroll loader. Pass a memoized `fetchPage`: when its
 * identity changes (a new data source), the list reloads from offset 0. Callers
 * must wrap `fetchPage` in useMemo keyed on the source so it is stable per source.
 *
 * Reusable by any photo collection — the Photos tab binds it to the active
 * catalog; an album screen later binds it to an album. Only `fetchPage` differs.
 */
export function usePhotoPages({
  fetchPage,
  pageSize = 100,
}: {
  fetchPage: FetchPage;
  pageSize?: number;
}) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs hold the live cursor so loadMore reads current values without being
  // recreated on every render and without racing concurrent pages. (Reading/
  // writing refs in event callbacks — not during render — is lint-safe.)
  const offsetRef = useRef(0);
  const loadedRef = useRef(0);
  const totalRef = useRef(0);
  const inFlightRef = useRef(false);

  const loadFirst = useCallback(() => {
    if (!fetchPage) return;
    offsetRef.current = 0;
    loadedRef.current = 0;
    totalRef.current = 0;
    inFlightRef.current = true;
    setIsLoading(true);
    setError(null);
    fetchPage(0, pageSize)
      .then((page) => {
        setPhotos(page.items);
        setTotal(page.total);
        loadedRef.current = page.items.length;
        totalRef.current = page.total;
        offsetRef.current = page.items.length;
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Couldn't load photos."),
      )
      .finally(() => {
        inFlightRef.current = false;
        setIsLoading(false);
      });
  }, [fetchPage, pageSize]);

  const loadMore = useCallback(() => {
    if (!fetchPage) return;
    if (inFlightRef.current) return;
    if (!hasMore(loadedRef.current, totalRef.current)) return;
    inFlightRef.current = true;
    setIsLoadingMore(true);
    fetchPage(offsetRef.current, pageSize)
      .then((page) => {
        setPhotos((prev) => mergeById(prev, page.items));
        setTotal(page.total);
        totalRef.current = page.total;
        loadedRef.current += page.items.length;
        offsetRef.current += page.items.length;
      })
      .catch(() => {
        // Keep what we have; a later scroll retries. Don't blank the grid.
      })
      .finally(() => {
        inFlightRef.current = false;
        setIsLoadingMore(false);
      });
  }, [fetchPage, pageSize]);

  // Reload whenever the data source changes. loadFirst's identity changes exactly
  // when fetchPage does, so depending on it reloads once per source change.
  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  return { photos, total, isLoading, isLoadingMore, error, loadMore, refetch: loadFirst };
}
```

- [ ] **Step 2: Typecheck/lint the file**

Run:
```bash
pnpm --filter @lumio/mobile lint
```
Expected: no errors for `use-photo-pages.ts` (warnings unrelated to this file are acceptable; fix any error it reports).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/hooks/use-photo-pages.ts
git commit -m "feat(mobile): usePhotoPages infinite-scroll hook"
```

---

## Task 5: Pinch zoom-level helper (`zoom.ts`)

**Files:**
- Create: `apps/mobile/src/components/photo-grid/zoom.ts`
- Test: `apps/mobile/src/components/photo-grid/zoom.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/components/photo-grid/zoom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextZoomLevel } from "./zoom";

const LEVELS = [1, 3, 5, 8]; // ascending column counts; lower index = bigger tiles

describe("nextZoomLevel", () => {
  it("zooms in (fewer columns) on a pinch-out past threshold", () => {
    expect(nextZoomLevel(LEVELS, 2, 1.5)).toBe(1);
  });
  it("zooms out (more columns) on a pinch-in past threshold", () => {
    expect(nextZoomLevel(LEVELS, 1, 0.5)).toBe(2);
  });
  it("stays put inside the dead zone", () => {
    expect(nextZoomLevel(LEVELS, 1, 1.0)).toBe(1);
  });
  it("clamps at the smallest-columns end (index 0)", () => {
    expect(nextZoomLevel(LEVELS, 0, 3)).toBe(0);
  });
  it("clamps at the most-columns end (last index)", () => {
    expect(nextZoomLevel(LEVELS, 3, 0.2)).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/mobile test`
Expected: FAIL — cannot resolve `./zoom`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/components/photo-grid/zoom.ts`:

```ts
// Pure pinch -> zoom-level logic for the zoomable grid. `levels` is the ascending
// list of column counts (e.g. [1, 3, 5, 8]); a lower index means fewer columns
// and larger tiles. A pinch-out (scale > 1) zooms IN -> fewer columns (lower
// index); a pinch-in (scale < 1) -> more columns (higher index). Within the dead
// zone the level is unchanged. The result index is clamped to the array bounds.

export const ZOOM_IN_THRESHOLD = 1.15;
export const ZOOM_OUT_THRESHOLD = 0.87;

export function nextZoomLevel(levels: number[], index: number, scale: number): number {
  if (scale >= ZOOM_IN_THRESHOLD) return Math.max(0, index - 1);
  if (scale <= ZOOM_OUT_THRESHOLD) return Math.min(levels.length - 1, index + 1);
  return index;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/mobile test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/photo-grid/zoom.ts apps/mobile/src/components/photo-grid/zoom.test.ts
git commit -m "feat(mobile): pure pinch zoom-level helper"
```

---

## Task 6: Photo tile (`photo-tile.tsx`)

**Files:**
- Create: `apps/mobile/src/components/photo-grid/photo-tile.tsx`

No unit test (presentational; verified manually). Depends on Task 2.

- [ ] **Step 1: Write the component**

Create `apps/mobile/src/components/photo-grid/photo-tile.tsx`:

```tsx
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { PhotoDTO } from "@lumio/shared";
import { thumbnailUrl } from "@/lib/photos-api";

/**
 * One square, cover-cropped grid tile (iOS Photos look). The base64 ThumbHash is
 * shown as a blur placeholder while the authenticated WebP thumbnail loads
 * (expo-image decodes ThumbHash natively). The session cookie is sent as a
 * request header because the thumbnail endpoint is auth-gated. `recyclingKey`
 * tells expo-image to drop the previous image when a cell is recycled by
 * FlashList, preventing a flash of the wrong photo.
 */
export const PhotoTile = memo(function PhotoTile({
  photo,
  baseURL,
  slug,
  cookie,
}: {
  photo: PhotoDTO;
  baseURL: string;
  slug: string;
  cookie: string;
}) {
  return (
    <View style={styles.cell}>
      <Image
        style={styles.image}
        source={{ uri: thumbnailUrl(baseURL, slug, photo), headers: { Cookie: cookie } }}
        placeholder={photo.thumbhash ? { thumbhash: photo.thumbhash } : undefined}
        contentFit="cover"
        transition={150}
        recyclingKey={photo.id}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  // flex:1 fills the FlashList column slot; aspectRatio keeps tiles square; the
  // 1px padding makes the ~2px inter-tile gap of the iOS Photos grid.
  cell: { flex: 1, aspectRatio: 1, padding: 1 },
  image: { flex: 1, backgroundColor: "rgba(127,127,127,0.12)" },
});
```

- [ ] **Step 2: Lint the file**

Run: `pnpm --filter @lumio/mobile lint`
Expected: no errors for `photo-tile.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/photo-grid/photo-tile.tsx
git commit -m "feat(mobile): PhotoTile (thumbhash blur + authed thumbnail)"
```

---

## Task 7: Zoomable grid (`zoomable-photo-grid.tsx` + barrel)

**Files:**
- Create: `apps/mobile/src/components/photo-grid/zoomable-photo-grid.tsx`
- Create: `apps/mobile/src/components/photo-grid/index.ts`

No unit test (presentational + gesture; verified manually). Depends on Tasks 5 and 6.

**Implementation note (refinement of the spec):** v1 commits the zoom on pinch **end** based on the accumulated scale (snap-to-level), rather than animating a continuous live scale. Snap-on-release keeps the gesture/scroll interaction robust on a virtualized list; continuous live scaling is a deliberate future enhancement. `Gesture.Pinch().runOnJS(true)` runs the callback on the JS thread so it can call `setState` directly (no reanimated bridge needed).

- [ ] **Step 1: Write the grid component**

Create `apps/mobile/src/components/photo-grid/zoomable-photo-grid.tsx`:

```tsx
import { type ReactElement, useCallback, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { PhotoDTO } from "@lumio/shared";
import { PhotoTile } from "./photo-tile";
import { nextZoomLevel } from "./zoom";

export const DEFAULT_ZOOM_LEVELS = [1, 3, 5, 8];

/**
 * Reusable iOS-Photos-style grid: square tiles on FlashList with pinch-to-zoom
 * between a fixed set of column counts. Renders PhotoTile directly (photos and
 * albums both show photos). Infinite scroll is driven by the parent via
 * onEndReached. The header overlay is the parent's concern — pass its onScroll
 * and a contentInset for top/bottom padding.
 */
export function ZoomablePhotoGrid({
  photos,
  baseURL,
  slug,
  cookie,
  zoomLevels = DEFAULT_ZOOM_LEVELS,
  initialColumns = 3,
  onColumnsChange,
  onEndReached,
  onScroll,
  contentInset,
  ListEmptyComponent,
  ListFooterComponent,
}: {
  photos: PhotoDTO[];
  baseURL: string;
  slug: string;
  cookie: string;
  zoomLevels?: number[];
  initialColumns?: number;
  onColumnsChange?: (columns: number) => void;
  onEndReached?: () => void;
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentInset?: { top: number; bottom: number };
  ListEmptyComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
}) {
  // Snap initialColumns onto a provided level; fall back to the middle level.
  const [columns, setColumns] = useState(() =>
    zoomLevels.includes(initialColumns)
      ? initialColumns
      : zoomLevels[Math.floor(zoomLevels.length / 2)],
  );
  const columnsRef = useRef(columns);

  const commitZoom = useCallback(
    (finalScale: number) => {
      const idx = zoomLevels.indexOf(columnsRef.current);
      if (idx < 0) return;
      const next = zoomLevels[nextZoomLevel(zoomLevels, idx, finalScale)];
      if (next !== columnsRef.current) {
        columnsRef.current = next;
        setColumns(next);
        onColumnsChange?.(next);
      }
    },
    [zoomLevels, onColumnsChange],
  );

  // Pinch callbacks run on the JS thread (runOnJS) so commitZoom can setState
  // directly. We snap on gesture end based on the accumulated scale.
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onEnd((e) => commitZoom(e.scale));

  const renderItem = useCallback(
    ({ item }: { item: PhotoDTO }) => (
      <PhotoTile photo={item} baseURL={baseURL} slug={slug} cookie={cookie} />
    ),
    [baseURL, slug, cookie],
  );

  return (
    <GestureDetector gesture={pinch}>
      <View style={styles.flex}>
        <FlashList
          data={photos}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          contentContainerStyle={
            contentInset
              ? { paddingTop: contentInset.top, paddingBottom: contentInset.bottom }
              : undefined
          }
          ListEmptyComponent={ListEmptyComponent}
          ListFooterComponent={ListFooterComponent}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
```

> If installed FlashList is **v1** (not v2), `renderItem`/list will warn that `estimatedItemSize` is required — add `estimatedItemSize={120}` to `<FlashList>`. v2 auto-measures and needs no such prop. If zooming ever leaves overlapping/misplaced tiles (a recycling artifact), add `key={columns}` to `<FlashList>` to force a clean re-layout (accepts a scroll-to-top on zoom).

- [ ] **Step 2: Write the barrel**

Create `apps/mobile/src/components/photo-grid/index.ts`:

```ts
export { ZoomablePhotoGrid, DEFAULT_ZOOM_LEVELS } from "./zoomable-photo-grid";
export { PhotoTile } from "./photo-tile";
```

- [ ] **Step 3: Lint the files**

Run: `pnpm --filter @lumio/mobile lint`
Expected: no errors for the new files.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/photo-grid/zoomable-photo-grid.tsx apps/mobile/src/components/photo-grid/index.ts
git commit -m "feat(mobile): ZoomablePhotoGrid (FlashList + pinch-to-zoom)"
```

---

## Task 8: Extract the reusable scroll-edge header

**Files:**
- Modify (rewrite): `apps/mobile/src/components/large-header.tsx`

Extracts `useScrollEdgeHeader()` (state + onScroll + status-bar logic) and `LargeHeaderOverlay` (title + progressive blur) from `LargeHeaderScreen`, then rebuilds `LargeHeaderScreen` on them. Its public API (`title`, `right`, `children`) and visuals are unchanged, so the Albums tab is unaffected. The Photos tab (Task 9) composes the overlay over a FlashList. No unit test (visual; verified manually).

- [ ] **Step 1: Rewrite `large-header.tsx`**

Replace the entire file with:

```tsx
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import {
  Animated,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { setStatusBarStyle } from "expo-status-bar";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, weight } from "@/lib/theme";

// Lets header actions (e.g. the gear) react to scroll — darker glass + white
// icon once the dark blur is in.
const HeaderScrollContext = createContext(false);
export const useHeaderScrolled = () => useContext(HeaderScrollContext);

const TITLE_ROW = 52;
// Extends a bit past the title so the blur covers the text slightly before the
// gradient tapers it out just below the baseline.
const BLUR_EXTRA = 40;
// Scroll distance at which the header is considered "scrolled".
const THRESHOLD = 8;

/**
 * Scroll-edge header state, reusable over ANY scroller (ScrollView or FlashList).
 * Returns the `scrolled` flag, the 0->1 `anim` value driving blur/title, an
 * `onScroll` handler to attach to the scroller, and `headerHeight` for content
 * padding. The status bar flips to light over the dark scrolled blur.
 */
export function useScrollEdgeHeader() {
  const insets = useSafeAreaInsets();
  const [scrolled, setScrolled] = useState(false);
  // Drives blur opacity + title color together (JS-driven; a short threshold
  // transition, not a per-frame scroll link).
  const [anim] = useState(() => new Animated.Value(0));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > THRESHOLD;
    if (next !== scrolled) {
      setScrolled(next);
      // Imperative so it reliably overrides the root StatusBar.
      setStatusBarStyle(next ? "light" : "auto", true);
      Animated.timing(anim, { toValue: next ? 1 : 0, duration: 220, useNativeDriver: false }).start();
    }
  };

  // Restore the default status bar when the screen unmounts (e.g. on logout).
  useEffect(() => () => setStatusBarStyle("auto", false), []);

  return { scrolled, anim, onScroll, headerHeight: insets.top + TITLE_ROW };
}

/**
 * The fixed large title + progressive scroll-edge blur. Absolutely positioned —
 * render it as a sibling ON TOP of a scroller whose onScroll comes from
 * useScrollEdgeHeader(). Provides HeaderScrollContext so the `right` slot can
 * react to scroll.
 */
export function LargeHeaderOverlay({
  title,
  right,
  scrolled,
  anim,
  headerHeight,
}: {
  title: string;
  right?: ReactNode;
  scrolled: boolean;
  anim: Animated.Value;
  headerHeight: number;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const titleColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.foreground, "#FFFFFF"],
  });

  return (
    <HeaderScrollContext.Provider value={scrolled}>
      {/* Progressive blur: subtle dark material, opaque at top, fading to clear
          at the bottom edge (no hard line). Fades in as you scroll. */}
      <Animated.View
        style={[styles.blurLayer, { height: headerHeight + BLUR_EXTRA, opacity: anim }]}
        pointerEvents="none"
      >
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              style={StyleSheet.absoluteFill}
              colors={["black", "black", "transparent"]}
              locations={[0, 0.7, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
            />
          }
        >
          <BlurView intensity={15} tint="dark" style={StyleSheet.absoluteFill} />
        </MaskedView>
      </Animated.View>

      <View
        style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        <View style={styles.titleRow} pointerEvents="box-none">
          <Animated.Text style={[styles.title, { color: titleColor }]} numberOfLines={1}>
            {title}
          </Animated.Text>
          {right}
        </View>
      </View>
    </HeaderScrollContext.Provider>
  );
}

/**
 * iOS Photos-style screen: a fixed large title over a ScrollView. For a
 * virtualized list (FlashList), compose useScrollEdgeHeader + LargeHeaderOverlay
 * directly over the list instead of using this wrapper.
 */
export function LargeHeaderScreen({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { scrolled, anim, onScroll, headerHeight } = useScrollEdgeHeader();

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: insets.bottom + 96 }}
        scrollIndicatorInsets={{ top: TITLE_ROW }}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {children}
      </ScrollView>
      <LargeHeaderOverlay
        title={title}
        right={right}
        scrolled={scrolled}
        anim={anim}
        headerHeight={headerHeight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  blurLayer: { position: "absolute", top: 0, left: 0, right: 0 },
  header: { position: "absolute", top: 0, left: 0, right: 0 },
  titleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  title: { fontSize: 32, fontWeight: weight.bold, letterSpacing: -0.5 },
});
```

- [ ] **Step 2: Lint + test**

Run:
```bash
pnpm --filter @lumio/mobile lint && pnpm --filter @lumio/mobile test
```
Expected: no new errors; tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/large-header.tsx
git commit -m "refactor(mobile): extract useScrollEdgeHeader + LargeHeaderOverlay"
```

---

## Task 9: Wire the Photos tab

**Files:**
- Modify (rewrite): `apps/mobile/src/app/(tabs)/photos/index.tsx`

Depends on Tasks 2, 4, 7, 8. (Leaves `empty-tab.tsx` / `PhotoGridPlaceholder` in place — the Albums tab still uses it.)

- [ ] **Step 1: Rewrite the Photos screen**

Replace `apps/mobile/src/app/(tabs)/photos/index.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LargeHeaderOverlay, useScrollEdgeHeader } from "@/components/large-header";
import { SettingsMenuButton } from "@/components/settings-menu-button";
import { ZoomablePhotoGrid } from "@/components/photo-grid";
import { usePhotoPages } from "@/hooks/use-photo-pages";
import { fetchPhotos } from "@/lib/photos-api";
import { useAuth } from "@/contexts/auth-context";
import { useCatalogs } from "@/contexts/catalog-context";
import { useTheme } from "@/lib/theme";

// Persisted grid density (column count), like the active catalog persists.
const ZOOM_KEY = "lumio.photoGridZoom";
const ZOOM_LEVELS = [1, 3, 5, 8];
const DEFAULT_COLUMNS = 3;

export default function Photos() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { serverUrl, getCookie } = useAuth();
  const { activeCatalog, isLoading: catalogLoading, error: catalogError } = useCatalogs();
  const { scrolled, anim, onScroll, headerHeight } = useScrollEdgeHeader();

  const slug = activeCatalog?.slug ?? null;
  const cookie = getCookie();

  // Restore the persisted zoom once on mount.
  const [initialColumns, setInitialColumns] = useState(DEFAULT_COLUMNS);
  const [zoomReady, setZoomReady] = useState(false);
  useEffect(() => {
    SecureStore.getItemAsync(ZOOM_KEY)
      .then((v) => {
        const n = v ? Number(v) : NaN;
        if (ZOOM_LEVELS.includes(n)) setInitialColumns(n);
      })
      .finally(() => setZoomReady(true));
  }, []);

  const onColumnsChange = useCallback((cols: number) => {
    void SecureStore.setItemAsync(ZOOM_KEY, String(cols));
  }, []);

  // Memoized per data source so usePhotoPages reloads only when the source
  // changes. cookie is captured by value (a stable string per session).
  const fetchPage = useMemo(
    () =>
      serverUrl && slug
        ? (offset: number, limit: number) =>
            fetchPhotos(serverUrl, slug, cookie, { limit, offset })
        : null,
    [serverUrl, slug, cookie],
  );

  const { photos, isLoading, isLoadingMore, error, loadMore, refetch } = usePhotoPages({
    fetchPage,
  });

  const showSpinner = !zoomReady || catalogLoading || (isLoading && photos.length === 0);
  const errMsg = error ?? catalogError;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {showSpinner ? (
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <ActivityIndicator />
        </View>
      ) : errMsg && photos.length === 0 ? (
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <Text style={[styles.msg, { color: colors.mutedForeground }]}>{errMsg}</Text>
          <Text onPress={refetch} style={[styles.retry, { color: colors.primary }]}>
            Retry
          </Text>
        </View>
      ) : (
        <ZoomablePhotoGrid
          photos={photos}
          baseURL={serverUrl ?? ""}
          slug={slug ?? ""}
          cookie={cookie}
          zoomLevels={ZOOM_LEVELS}
          initialColumns={initialColumns}
          onColumnsChange={onColumnsChange}
          onEndReached={loadMore}
          onScroll={onScroll}
          contentInset={{ top: headerHeight + 8, bottom: insets.bottom + 96 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.msg, { color: colors.mutedForeground }]}>No photos yet</Text>
            </View>
          }
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator />
              </View>
            ) : null
          }
        />
      )}
      <LargeHeaderOverlay
        title="Photos"
        right={<SettingsMenuButton />}
        scrolled={scrolled}
        anim={anim}
        headerHeight={headerHeight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  empty: { alignItems: "center", paddingTop: 64 },
  msg: { fontSize: 15 },
  retry: { fontSize: 15, fontWeight: "600" },
  footer: { paddingVertical: 24, alignItems: "center" },
});
```

- [ ] **Step 2: Lint + test**

Run:
```bash
pnpm --filter @lumio/mobile lint && pnpm --filter @lumio/mobile test
```
Expected: no errors; tests PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/src/app/(tabs)/photos/index.tsx"
git commit -m "feat(mobile): Photos tab shows the catalog's zoomable photo grid"
```

---

## Task 10: Full verification (manual, iOS simulator)

**Files:** none (verification only).

- [ ] **Step 1: Lint + unit tests green**

Run:
```bash
pnpm --filter @lumio/mobile lint && pnpm --filter @lumio/mobile test
```
Expected: lint clean; all vitest suites PASS (`normalizeServerUrl`, `fetchPhotos`/`thumbnailUrl`, `mergeById`/`hasMore`, `nextZoomLevel`).

- [ ] **Step 2: Boot against a running backend**

Ensure the web backend is running (`pnpm dev`, DB up) with a seeded catalog containing photos. Then:
```bash
make ios
```
On the `connect` screen enter `http://localhost:3000` (simulator), sign in, land on the Photos tab.

- [ ] **Step 3: Walk the acceptance checklist** (from the spec)

- [ ] Photos tab shows real catalog thumbnails, newest first; the ThumbHash blur appears, then resolves to the WebP.
- [ ] Pinch out → fewer/larger tiles; pinch in → more/smaller tiles, stepping through `[1, 3, 5, 8]`.
- [ ] Fully close and relaunch the app → the last zoom level is restored.
- [ ] Scrolling toward the bottom loads more (footer spinner) until the catalog is exhausted; no duplicate tiles.
- [ ] The large title + scroll-edge blur behave over the grid as before; the **Albums** tab looks unchanged.
- [ ] An empty catalog shows "No photos yet"; stopping the server then pull-to-reload / re-enter shows the error message with a working **Retry**.

- [ ] **Step 4: Final commit (only if Step 3 surfaced fixes)**

```bash
git add -A
git commit -m "fix(mobile): photo grid verification fixes"
```

---

## Notes & deferred work
- **Tap-to-open / lightbox**, selection, favorites, sorting/filter UI, and the Albums *screens* are out of scope (the grid + hook are built to be reused by Albums later — swap only the `fetchPage`).
- **Continuous live-scale pinch feedback** (cross-fading layouts mid-gesture) is deferred; v1 snaps on release.
- If a future grid needs non-photo cells, generalize `ZoomablePhotoGrid` with a `renderItem` prop then (YAGNI now).
