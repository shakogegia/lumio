import { existsSync } from "node:fs";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import sharp from "sharp";
import { coercePhotoEdits, hasEdits, type DownloadVariant } from "@lumio/shared";
import { applyEdits, decodeToSharpInput } from "@lumio/ingest";
import { originalPath } from "@/lib/paths";

/**
 * Build a download filename for an entry inside a zip. Entries are flattened to
 * their basename; collisions across source folders are de-duplicated with a
 * numeric suffix inserted before the extension (`a.jpg`, `a (2).jpg`, …).
 * Mutates `used` with the chosen name.
 */
export function dedupeEntryName(basename: string, used: Set<string>): string {
  if (!used.has(basename)) {
    used.add(basename);
    return basename;
  }
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const ext = dot > 0 ? basename.slice(dot) : "";
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Turn an album name into a safe zip filename (no path separators or reserved
 * characters), falling back to "album" when the result is empty. Does not
 * include the ".zip" extension — the caller appends it.
 */
export function sanitizeZipName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "-")
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || "album";
}

/**
 * Build a `Content-Disposition: attachment` header value with an ASCII filename
 * fallback plus a UTF-8 `filename*` parameter (RFC 5987 / 6266), so unicode
 * names survive in modern browsers while older clients still get a usable name.
 */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Stream the given photos as a single stored (uncompressed) zip. When
 * `variant` is "edited", photos that carry edit recipes are re-rendered to
 * full-res JPEG with the recipe baked in; photos without edits keep their
 * original bytes. When `variant` is "original" (the default), every photo
 * uses its original bytes unchanged. `resolve` maps a photo's stored relative
 * path to an absolute path on disk (defaults to `originalPath`, the
 * traversal-guarded resolver; overridable for tests). Missing originals are
 * logged and skipped — never fatal.
 */
export function streamPhotosZip(
  photos: { id: string; path: string; edits?: unknown }[],
  zipName: string,
  variant: DownloadVariant = "original",
  resolve: (relPath: string) => string = originalPath,
): Response {
  const archive = new ZipArchive({ store: true });
  const pass = new PassThrough();

  archive.on("warning", (err) => {
    console.warn("[download] zip warning:", err);
  });
  archive.on("error", (err) => {
    console.error("[download] zip error:", err);
    pass.destroy(err);
  });
  archive.pipe(pass);

  const used = new Set<string>();
  void (async () => {
    for (const photo of photos) {
      const abs = resolve(photo.path);
      if (!existsSync(abs)) {
        console.warn("[download] skipping missing original:", photo.path);
        continue;
      }
      const base = photo.path.split("/").pop() || photo.path;
      const recipe = coercePhotoEdits(photo.edits);
      if (variant === "edited" && hasEdits(recipe)) {
        const decoded = await decodeToSharpInput(abs);
        try {
          const oriented = await sharp(decoded.input).rotate().toBuffer();
          const jpeg = await applyEdits(sharp(oriented), recipe)
            .jpeg({ quality: 92 })
            .toBuffer();
          const dot = base.lastIndexOf(".");
          const name = `${dot > 0 ? base.slice(0, dot) : base}.jpg`;
          archive.append(jpeg, { name: dedupeEntryName(name, used) });
        } finally {
          await decoded.cleanup();
        }
      } else {
        archive.file(abs, { name: dedupeEntryName(base, used) });
      }
    }
    void archive.finalize();
  })();

  return new Response(Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentDisposition(zipName),
    },
  });
}
