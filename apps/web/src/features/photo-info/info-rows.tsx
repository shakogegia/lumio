import type { ReactNode } from "react";
import type { PhotoDTO } from "@lumio/shared";

/** The fixed per-photo facts shown in the Info tab. */
export function InfoRows({ photo }: { photo: PhotoDTO }) {
  return (
    <div className="space-y-1">
      <Row label="Source" value={<span className="capitalize">{photo.source}</span>} />
      <Row label="Date taken" value={formatDate(photo.takenAt)} />
      <Row label="Date imported" value={formatDate(photo.createdAt)} />
      <Row label="File created" value={formatDate(photo.fileCreatedAt)} />
    </div>
  );
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
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
