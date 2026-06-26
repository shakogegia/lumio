import type { ReactNode } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";

/** The fixed per-photo facts shown in the Info tab. */
export function InfoRows({ photo }: { photo: PhotoDTO }) {
  return (
    <div className="space-y-1">
      <Row label="Source" value={<Badge>{photo.source}</Badge>} />
      <Row label="File created" value={formatCreated(photo.fileCreatedAt)} />
    </div>
  );
}

/** ISO timestamp → "Jun 26, 2026" (UTC, matching the app's standard date style). */
function formatCreated(iso: string | null): string {
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
