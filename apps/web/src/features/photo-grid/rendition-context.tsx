"use client";

import { createContext, useContext, useMemo } from "react";
import type { PhotoDTO } from "@lumio/shared";
import {
  thumbUrl,
  displayUrl,
  baseDisplayUrl,
  renditionVersion,
} from "@/lib/rendition-url";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";

/**
 * Single injectable source of rendition image URLs. The grid/lightbox/editor build
 * every image src through this interface instead of calling the URL builders
 * directly, so a different surface (e.g. a public share gallery) can supply its own
 * URL builder by wrapping the tree in a {@link RenditionProvider}. The authed
 * catalog app needs no provider: {@link useRenditions} falls back to the catalog
 * default, which reproduces today's URLs byte-for-byte.
 */
export interface RenditionUrls {
  /** Grid thumbnail (versioned by updatedAt). */
  thumb(photo: Pick<PhotoDTO, "id" | "updatedAt">): string;
  /** Film-strip thumbnail, versioned by a pre-resolved `v` carried on the item. */
  thumbVersioned(id: string, v: number): string;
  /** Display rendition for views (versioned by updatedAt). */
  display(photo: Pick<PhotoDTO, "id" | "updatedAt">): string;
  /** Edit-free base display (editor canvas source, immutable, no version). */
  base(photo: Pick<PhotoDTO, "id">): string;
  /** Full-res source for an unedited photo's deep zoom (the original, no version). */
  fullOriginal(photo: Pick<PhotoDTO, "id">): string;
  /** Full-res source for an edited photo's deep zoom (the baked edited rendition,
   *  versioned by updatedAt). */
  fullEdited(photo: Pick<PhotoDTO, "id" | "updatedAt">): string;
  /** Attachment URL for the lightbox's per-photo download control. `variant`
   *  selects edited vs. original on the authed catalog (defaults to original); a
   *  restricted surface that serves a single baked variant ignores it. */
  download(photo: Pick<PhotoDTO, "id">, variant?: "edited" | "original"): string;
}

const RenditionContext = createContext<RenditionUrls | null>(null);

export function RenditionProvider({
  value,
  children,
}: {
  value: RenditionUrls;
  children: React.ReactNode;
}) {
  return (
    <RenditionContext.Provider value={value}>
      {children}
    </RenditionContext.Provider>
  );
}

/**
 * Pure builder for the catalog (authed) URLs — identical to what the app produces
 * today. Each method delegates to the same `rendition-url`/`catalog-api` helpers
 * the consumers used inline before this indirection was introduced.
 */
export function catalogRenditions(slug: string): RenditionUrls {
  return {
    thumb: (photo) => thumbUrl(slug, photo),
    thumbVersioned: (id, v) =>
      catalogApiUrl(slug, `/photos/${id}/thumbnail?v=${v}`),
    display: (photo) => displayUrl(slug, photo),
    base: (photo) => baseDisplayUrl(slug, photo),
    fullOriginal: (photo) => catalogApiUrl(slug, `/photos/${photo.id}/original`),
    fullEdited: (photo) =>
      catalogApiUrl(
        slug,
        `/photos/${photo.id}/edited?v=${renditionVersion(photo.updatedAt)}`,
      ),
    // Byte-identical to the URLs the lightbox built inline before this seam: the
    // edited/original attachment variant under the catalog API.
    download: (photo, variant = "original") =>
      catalogApiUrl(
        slug,
        `/photos/${photo.id}/${variant === "edited" ? "edited" : "original"}?download=1`,
      ),
  };
}

/**
 * The active rendition URL source. Falls back to the catalog default when no
 * provider is present, so the authed app needs no provider seeding and cannot
 * crash. `useCatalog()` is always called (hook rules); the authed app always has a
 * CatalogProvider above it.
 */
export function useRenditions(): RenditionUrls {
  const ctx = useContext(RenditionContext);
  const { slug } = useCatalog();
  // Memoize so the fallback returns a stable reference (it's read as a hook/effect
  // dependency downstream; a fresh object each render would over-fire those effects).
  return useMemo(() => ctx ?? catalogRenditions(slug), [ctx, slug]);
}
