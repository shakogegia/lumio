import type { ReactNode } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";

/** The fixed per-photo facts shown in the Info tab. */
export function InfoRows({ photo }: { photo: PhotoDTO }) {
  return (
    <div className="space-y-3">
      <Row label="Source" value={<Badge>{photo.source}</Badge>} />
      <Row label="File created" value={photo.fileCreatedAt ?? "—"} />
      <Row label="File modified" value={photo.fileModifiedAt ?? "—"} />
      <Row label="Hash" value={photo.hash ?? "—"} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
