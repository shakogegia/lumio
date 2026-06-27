import type { ReactNode } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { formatBytes } from "@/lib/format";

/** The fixed per-photo facts shown in the Info tab. */
export function InfoRows({ photo }: { photo: PhotoDTO }) {
  return (
    <div className="space-y-1">
      <Row label="Source" value={<span className="capitalize">{photo.source}</span>} />
      <Row label="Folder" value={<span title={relativeFolder(photo.path)}>{relativeFolder(photo.path)}</span>} />
      <Row label="Resolution" value={`${photo.width} × ${photo.height}`} />
      <Row label="Megapixels" value={formatMegapixels(photo.width, photo.height)} />
      <Row label="File size" value={photo.fileSize == null ? "—" : formatBytes(photo.fileSize)} />
      <Row label="Date taken" value={formatDate(photo.takenAt)} />
      <Row label="Date imported" value={formatDate(photo.createdAt)} />
      <Row label="File created" value={formatDate(photo.fileCreatedAt)} />
    </div>
  );
}

/** Catalog-relative directory of a photo's path, or "/" when it sits at the root. */
function relativeFolder(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash === -1 ? "/" : relPath.slice(0, slash);
}

/** Pixel dimensions → "12.2 MP" (one decimal, trailing ".0" dropped). */
function formatMegapixels(width: number, height: number): string {
  const mp = (width * height) / 1_000_000;
  if (!Number.isFinite(mp) || mp <= 0) return "—";
  const rounded = Math.round(mp * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} MP`;
}

/** ISO timestamp → "Jun 26, 2026" (UTC, matching the app's standard date style). */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-center gap-3">
      <span className="text-right text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-left text-xs">{value}</span>
    </div>
  );
}
