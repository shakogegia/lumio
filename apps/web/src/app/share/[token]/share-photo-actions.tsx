"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { downloadFromUrl } from "@/lib/download-client";
import type {
  ActionOpts,
  PhotoActions,
} from "@/components/photo-actions/use-photo-actions";
import type { PhotoCapabilities } from "@/components/photo-actions/photo-capabilities";
import {
  shareDownloadUrl,
  shareDownloadSelectedUrl,
} from "@/lib/share-url";

/** A public viewer can browse, zoom, and download — nothing that mutates the
 *  library (favorite/label/album/cover/trash) or reveals the editor/EXIF, and no
 *  nested share creation. The shared action UIs render each control only when its
 *  capability is true, so the disabled methods below are never reached. */
export const PUBLIC_CAPABILITIES: PhotoCapabilities = {
  download: true,
  downloadAll: true,
  favorite: false,
  label: false,
  addToAlbum: false,
  setCover: false,
  trash: false,
  edit: false,
  details: false,
  createShare: false,
};

const noop = (): void => undefined;
const noopAsync = (): Promise<void> => Promise.resolve();

/**
 * The public {@link PhotoActions} value for the share gallery: a real `download`
 * (single attachment for one id, a streamed subset zip for many) over the
 * `/api/share` routes. Every other method is an inert stub — the capabilities
 * above hide their controls, so they are never invoked. Mirrors the authed
 * `downloadSelection` shape but token-scoped and with no catalog session.
 */
export function useSharePhotoActions(token: string, title: string): PhotoActions {
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(
    async (ids: string[], opts?: ActionOpts) => {
      if (ids.length === 0 || downloading) return;
      setDownloading(true);
      try {
        if (ids.length === 1) {
          // One photo: a real download via the server's Content-Disposition.
          downloadFromUrl(shareDownloadUrl(token, ids[0]!));
        } else {
          // Many: POST the ids, read the zip blob, save it client-side (blob URLs
          // ignore Content-Disposition, so the name is set here from the title).
          const res = await fetch(shareDownloadSelectedUrl(token), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids }),
          });
          if (!res.ok) throw new Error("download failed");
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          try {
            const a = document.createElement("a");
            a.href = url;
            a.download = `${title || "shared-photos"}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to download photos.");
      } finally {
        setDownloading(false);
      }
    },
    [downloading, token, title],
  );

  // Library-mutating / editor methods: never reached (capabilities hide their
  // controls). They satisfy the PhotoActions shape as inert stubs.
  return {
    download,
    applyLabel: noopAsync,
    trash: noopAsync,
    favorite: noopAsync,
    addToAlbum: noop,
    addToAlbumDirect: noopAsync,
    share: noop,
    setAlbumCover: noopAsync,
    excludeAlbumId: undefined,
    albumCover: undefined,
    pending: { download: downloading, label: false, trash: false, favorite: false },
    element: null,
  };
}
