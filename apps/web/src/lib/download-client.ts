import type { DownloadVariant } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";

/** Trigger a browser download of a same-origin URL via a transient anchor.
 *  The server's Content-Disposition supplies the filename. */
export function downloadFromUrl(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download the selected photos: a bare original (or edited) for one, a
 * streamed zip for many. The 2+ path POSTs the ids + variant, reads the
 * response as a blob, and saves it via an object URL (blob URLs ignore
 * Content-Disposition, so the filename is set client-side). Throws on a
 * failed request so callers can surface an error.
 */
export async function downloadSelection(
  slug: string,
  ids: string[],
  variant: DownloadVariant = "original",
): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length === 1) {
    const path = variant === "edited" ? "edited" : "original";
    downloadFromUrl(catalogApiUrl(slug, `/photos/${ids[0]}/${path}?download=1`));
    return;
  }
  const res = await fetch(catalogApiUrl(slug, "/photos/download"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, variant }),
  });
  if (!res.ok) throw new Error("download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `lumio-photos-${ids.length}${variant === "edited" ? "-edited" : ""}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
