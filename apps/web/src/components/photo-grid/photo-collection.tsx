// apps/web/src/components/photo-grid/photo-collection.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PhotoDTO } from "@lumio/shared";
import { PHOTO_PAGE_SIZE } from "@/lib/grid-layout";
import { photoIdFromPathname } from "@/lib/pathname-photo-id";
import { usePhotoPages } from "./use-photo-pages";

/** How far around the open photo to keep loaded (neighbors + film strip). */
const LIGHTBOX_WINDOW = PHOTO_PAGE_SIZE;
/** Neighbors whose /display image we warm so arrow-nav is instant. */
const PRELOAD_RADIUS = 2;

interface PhotoCollectionValue {
  total: number | null;
  photoAt: (index: number) => PhotoDTO | undefined;
  getLoadedIds: () => string[];
  ensureRange: (start: number, end: number) => void;
  patchPhotos: (ids: Set<string>, patch: Partial<PhotoDTO>) => void;
  removePhotos: (ids: Set<string>) => void;
  error: boolean;
  retry: () => void;
  // Lightbox
  enableLightbox: boolean;
  openIndex: number | null;
  open: (index: number) => void;
  close: () => void;
  step: (delta: 1 | -1) => void;
  urlForId: (id: string) => string;
}

const Ctx = createContext<PhotoCollectionValue | null>(null);

export function usePhotoCollection(): PhotoCollectionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePhotoCollection must be used within PhotoCollectionProvider");
  return v;
}

export function PhotoCollectionProvider({
  endpoint = "/api/photos",
  params,
  urlForId,
  baseUrl,
  enableLightbox = true,
  initialIndex = null,
  initialPhoto = null,
  children,
}: {
  endpoint?: string;
  params?: URLSearchParams;
  /** Detail URL for a photo id (carries scope). Required when enableLightbox. */
  urlForId?: (id: string) => string;
  /** Grid URL to restore on close from a deep link. */
  baseUrl?: string;
  enableLightbox?: boolean;
  initialIndex?: number | null;
  initialPhoto?: PhotoDTO | null;
  children: React.ReactNode;
}) {
  const store = usePhotoPages(endpoint, params, PHOTO_PAGE_SIZE);
  const [openIndex, setOpenIndex] = useState<number | null>(initialIndex);
  // True once we've pushed a history entry for the lightbox this session, so
  // close() can pop it (restoring grid scroll) rather than replacing the URL.
  const pushed = useRef(false);
  const url = useCallback((id: string) => (urlForId ? urlForId(id) : `/photo/${id}`), [urlForId]);

  // Destructure the stable members of the store. usePhotoPages returns a fresh
  // object literal each render, so depending on `store` directly would recompute
  // the value memo and re-subscribe the popstate listener every render. Each of
  // these members is individually stable (primitive, or a useCallback whose
  // identity changes only when the underlying store actually changes), so
  // depending on them is behavior-identical and avoids the churn.
  const {
    total,
    photoAt,
    getLoadedIds,
    ensureRange,
    patchPhotos,
    removePhotos,
    error,
    retry,
  } = store;

  // On a deep link the store page for initialIndex hasn't loaded yet — serve the
  // SSR'd photo as a fallback for exactly that index until the page arrives.
  const photoForIndex = useCallback(
    (index: number): PhotoDTO | undefined => {
      const fromStore = photoAt(index);
      if (fromStore) return fromStore;
      if (initialPhoto && index === initialIndex) return initialPhoto;
      return undefined;
    },
    [photoAt, initialPhoto, initialIndex],
  );

  // Keep the window around the open photo loaded.
  useEffect(() => {
    if (openIndex === null) return;
    ensureRange(openIndex - LIGHTBOX_WINDOW, openIndex + LIGHTBOX_WINDOW);
  }, [openIndex, ensureRange]);

  // Warm neighbor /display images.
  useEffect(() => {
    if (openIndex === null) return;
    for (let d = 1; d <= PRELOAD_RADIUS; d++) {
      for (const i of [openIndex + d, openIndex - d]) {
        const p = photoForIndex(i);
        if (p) {
          const img = new Image();
          img.src = `/api/photos/${p.id}/display`;
        }
      }
    }
  }, [openIndex, photoForIndex]);

  // Keep the address bar on the current photo. Also covers the post-trash shift,
  // where the index is unchanged but the photo at it changes (photoForIndex's
  // identity changes when the store mutates). open() creates the history entry;
  // this only ever *replaces*, so it never stacks entries or fires an RSC fetch.
  useEffect(() => {
    if (openIndex === null || typeof window === "undefined") return;
    const p = photoForIndex(openIndex);
    if (p) window.history.replaceState(null, "", url(p.id));
  }, [openIndex, photoForIndex, url]);

  const open = useCallback(
    (index: number) => {
      if (!enableLightbox) return;
      setOpenIndex((cur) => {
        // First open this session pushes ONE history entry; navigating within the
        // already-open lightbox (film-strip jumps, arrows) only replaces — the
        // URL-sync effect handles that. Keeps `pushed` meaning exactly "one back()
        // returns to the grid", so close() stays correct no matter how many strip
        // jumps happen.
        if (cur === null && typeof window !== "undefined") {
          const p = photoForIndex(index);
          if (p) {
            window.history.pushState(null, "", url(p.id));
            pushed.current = true;
          }
        }
        return index;
      });
    },
    [enableLightbox, photoForIndex, url],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      setOpenIndex((cur) => {
        if (cur === null) return cur;
        const t = total ?? 0;
        const next = cur + delta;
        if (next < 0 || next >= t) return cur;
        return next;
      });
    },
    [total],
  );

  const close = useCallback(() => {
    if (typeof window !== "undefined" && pushed.current) {
      pushed.current = false;
      window.history.back(); // pops the pushed entry → popstate closes + restores scroll
      return;
    }
    if (typeof window !== "undefined" && baseUrl) {
      window.history.replaceState(null, "", baseUrl);
    }
    setOpenIndex(null);
  }, [baseUrl]);

  // Reconcile browser back/forward with open state. Read getLoadedIds through a
  // ref so the listener binds once instead of re-subscribing on every page fetch
  // (getLoadedIds' identity changes whenever a page loads). popEpoch guards the
  // async locate path so a newer popstate/close can't be clobbered by an older
  // in-flight resolve.
  const getLoadedIdsRef = useRef(getLoadedIds);
  useEffect(() => {
    getLoadedIdsRef.current = getLoadedIds;
  }, [getLoadedIds]);
  const popEpoch = useRef(0);

  useEffect(() => {
    if (!enableLightbox || typeof window === "undefined") return;
    const onPop = () => {
      const id = photoIdFromPathname(window.location.pathname);
      if (!id) {
        pushed.current = false;
        setOpenIndex(null);
        return;
      }
      const loaded = getLoadedIdsRef.current().indexOf(id); // sparse array; -1 if not loaded
      if (loaded !== -1) {
        setOpenIndex(loaded);
        return;
      }
      const epoch = ++popEpoch.current;
      void fetchLocateIndex(url, id).then((idx) => {
        if (idx !== null && popEpoch.current === epoch) setOpenIndex(idx);
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enableLightbox, url]);

  const value = useMemo<PhotoCollectionValue>(
    () => ({
      total,
      photoAt: photoForIndex,
      getLoadedIds,
      ensureRange,
      patchPhotos,
      removePhotos,
      error,
      retry,
      enableLightbox,
      openIndex,
      open,
      close,
      step,
      urlForId: url,
    }),
    [
      total,
      photoForIndex,
      getLoadedIds,
      ensureRange,
      patchPhotos,
      removePhotos,
      error,
      retry,
      enableLightbox,
      openIndex,
      open,
      close,
      step,
      url,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Resolve an unloaded photo's index via the locate endpoint. `url(id)` gives the
 *  detail URL whose query string carries the scope, which locate also accepts. */
async function fetchLocateIndex(url: (id: string) => string, id: string): Promise<number | null> {
  const detail = url(id); // e.g. /photo/<id>?album=..&sort=..
  const qs = detail.includes("?") ? `&${detail.split("?")[1]}` : "";
  try {
    const res = await fetch(`/api/photos/locate?id=${encodeURIComponent(id)}${qs}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { index: number };
    return data.index;
  } catch {
    return null;
  }
}
