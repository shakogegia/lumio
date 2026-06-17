"use client";

import { useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function PhotoDetail({ photo }: { photo: PhotoDTO }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/photos/${photo.id}/original`}
        alt={photo.path}
        className="max-h-[80vh] w-full rounded-lg object-contain"
      />
      <Sheet open={open} onOpenChange={(o) => setOpen(o)}>
        <SheetTrigger render={<Button variant="secondary">Details</Button>} />
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{photo.path}</SheetTitle>
            <SheetDescription>Photo metadata</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge>{photo.source}</Badge>
              <span className="text-muted-foreground">
                {photo.width}×{photo.height}
              </span>
            </div>
            <Row label="Taken" value={photo.takenAt ?? "—"} />
            <Row label="Camera" value={photo.exif.cameraModel ?? "—"} />
            <Row label="Hash" value={photo.hash ?? "—"} />
            <pre className="overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(photo.exif, null, 2)}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
