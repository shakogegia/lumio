"use client";

import type { PhotoDTO } from "@lumio/shared";
import {
  RenditionProvider,
  type RenditionUrls,
} from "@/features/photo-grid/rendition-context";
import { renditionVersion } from "@/lib/rendition-url";
import {
  shareThumbUrl,
  shareDisplayUrl,
  shareFullUrl,
  shareDownloadUrl,
} from "@/lib/share-url";

/**
 * Token-scoped rendition URLs for the public share gallery. Every image src the
 * shared grid/lightbox/zoom builds (it asks {@link RenditionUrls}, never the
 * catalog URL builders directly) is redirected through the public `/api/share`
 * routes — so the same authed components serve a viewer who has no catalog
 * session. Full-res zoom and per-photo download both resolve to the server's
 * baked rendition; the untouched original is never exposed publicly.
 */
export function shareRenditions(token: string): RenditionUrls {
  const v = (photo: Pick<PhotoDTO, "updatedAt">) => renditionVersion(photo.updatedAt);
  return {
    thumb: (photo) => shareThumbUrl(token, photo.id, v(photo)),
    thumbVersioned: (id, ver) => shareThumbUrl(token, id, ver),
    display: (photo) => shareDisplayUrl(token, photo.id, v(photo)),
    // No crop publicly — the base (editor canvas) is never reached on the share
    // surface (edit/details capabilities are off); it mirrors the display route
    // with a stable version so it can't crash if ever resolved.
    base: (photo) => shareDisplayUrl(token, photo.id, 0),
    // Both zoom sources point at the baked full-res; the public surface never
    // serves the untouched original, edited or not.
    fullOriginal: (photo) => shareFullUrl(token, photo.id),
    fullEdited: (photo) => shareFullUrl(token, photo.id),
    // The lightbox download control; variant is irrelevant publicly (one baked
    // attachment), so it's ignored.
    download: (photo) => shareDownloadUrl(token, photo.id),
  };
}

export function ShareRenditionProvider({
  token,
  children,
}: {
  token: string;
  children: React.ReactNode;
}) {
  return (
    <RenditionProvider value={shareRenditions(token)}>{children}</RenditionProvider>
  );
}
