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
import type { DetailScope } from "@/lib/detail-scope";
import { collectionForScope } from "@/lib/photo-collection-scope";
import { displayUrl } from "@/lib/rendition-url";
import { useCatalog } from "@/lib/catalog-context";
import { LightboxTab } from "@/lib/lightbox-tab";
import { usePhotoPages } from "./use-photo-pages";

/** How far around the open photo to keep loaded (neighbors + film strip). */
const LIGHTBOX_WINDOW = PHOTO_PAGE_SIZE;
/** Neighbors whose /display image we warm so arrow-nav is instant. */
const PRELOAD_RADIUS = 2;

interface PhotoCollectionValue {
  total: number | null;
  photoAt: (index: number) => PhotoDTO | undefined;
  getLoadedIds: () => string[];
  getPhotos: (ids: Set<string>) => PhotoDTO[];
  ensureRange: (start: number, end: number) => void;
  patchPhotos: (ids: Set<string>, patch: Partial<PhotoDTO>) => void;
  removePhotos: (ids: Set<string>) => void;
  error: boolean;
  retry: () => void;
  // Lightbox
  enableLightbox: boolean;
  openIndex: number | null;
  /** The tab the lightbox should show on this open (defaults to Info). */
  openTab: LightboxTab;
  /** Switch the lightbox sidebar tab (drives the controlled Tabs + i/e keys). */
  setOpenTab: (tab: LightboxTab) => void;
  open: (index: number, opts?: { tab?: LightboxTab }) => void;
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
  scope,
  endpoint = "/api/photos",
  params,
  urlForId,
  baseUrl,
  enableLightbox = true,
  initialIndex = null,
  initialPhoto = null,
  children,
}: {
  /** Serializable scope used to seed the provider from a Server Component (the
   *  deep-link route): when present, endpoint/params/urlForId/baseUrl are derived
   *  from it on the client, so no function or URLSearchParams prop has to cross
   *  the RSC boundary. Client grid views pass the explicit props below instead. */
  scope?: DetailScope;
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
  const { slug } = useCatalog();
  // Seeded from a Server Component? Derive the store source + URLs from `scope` on
  // the client (collectionForScope is pure/client-safe). Otherwise use the
  // explicit props the client grid views pass.
  const derived = useMemo(() => (scope ? collectionForScope(scope) : null), [scope]);
  const resolvedEndpoint = derived?.endpoint ?? endpoint;
  const resolvedParams = derived?.params ?? params;
  const resolvedBaseUrl = derived?.baseUrl ?? baseUrl;
  const resolvedUrlForId = derived?.urlForId ?? urlForId;

  const store = usePhotoPages(resolvedEndpoint, resolvedParams, PHOTO_PAGE_SIZE);
  const [openIndex, setOpenIndex] = useState<number | null>(initialIndex);
  const [openTab, setOpenTab] = useState<LightboxTab>(LightboxTab.Info);
  // True once we've pushed a history entry for the lightbox this session, so
  // close() can pop it (restoring grid scroll) rather than replacing the URL.
  const pushed = useRef(false);
  const url = useCallback(
    (id: string) => (resolvedUrlForId ? resolvedUrlForId(id) : `/photo/${id}`),
    [resolvedUrlForId],
  );

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
    getPhotos,
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
          img.src = displayUrl(slug, p);
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
    (index: number, opts?: { tab?: LightboxTab }) => {
      if (!enableLightbox) return;
      // First open of this session pushes ONE history entry; navigating within the
      // already-open lightbox (film-strip jumps, arrows) only replaces — the
      // URL-sync effect handles that, so `pushed` always means "one back() returns
      // to the grid" and close() stays correct. The pushState runs HERE in the
      // event handler, reading the current openIndex — NOT inside a setState
      // updater (React may invoke updaters during render, and a side effect there
      // throws "cannot update Router while rendering").
      if (openIndex === null && typeof window !== "undefined") {
        const p = photoForIndex(index);
        if (p) {
          window.history.pushState(null, "", url(p.id));
          pushed.current = true;
        }
      }
      // Always reset to Info unless a tab is requested, so double-click /
      // film-strip / deep-link opens never inherit a stale Edit tab.
      setOpenTab(opts?.tab ?? LightboxTab.Info);
      setOpenIndex(index);
    },
    [enableLightbox, openIndex, photoForIndex, url],
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
    if (typeof window !== "undefined" && resolvedBaseUrl) {
      window.history.replaceState(null, "", resolvedBaseUrl);
    }
    setOpenIndex(null);
  }, [resolvedBaseUrl]);

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
      getPhotos,
      ensureRange,
      patchPhotos,
      removePhotos,
      error,
      retry,
      enableLightbox,
      openIndex,
      openTab,
      setOpenTab,
      open,
      close,
      step,
      urlForId: url,
    }),
    [
      total,
      photoForIndex,
      getLoadedIds,
      getPhotos,
      ensureRange,
      patchPhotos,
      removePhotos,
      error,
      retry,
      enableLightbox,
      openIndex,
      openTab,
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
