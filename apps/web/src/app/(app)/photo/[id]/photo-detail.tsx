"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AlbumSummaryDTO, PhotoDTO } from "@lumio/shared";
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

export function PhotoDetail({
  photo,
  regularAlbums,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/photos/${photo.id}/display`}
        alt={photo.path}
        className="max-h-[80vh] w-full rounded-lg object-contain"
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="secondary">Details</Button>
        </SheetTrigger>
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
          {regularAlbums.length > 0 && (
            <AlbumMembership photo={photo} regularAlbums={regularAlbums} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AlbumMembership({
  photo,
  regularAlbums,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(album: AlbumSummaryDTO) {
    const isMember = photo.albumIds?.includes(album.id) ?? false;
    setPending(album.id);
    try {
      if (isMember) {
        await fetch(`/api/albums/${album.id}/photos/${photo.id}`, {
          method: "DELETE",
        });
      } else {
        await fetch(`/api/albums/${album.id}/photos`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: [photo.id] }),
        });
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="border-t px-4 pt-4 pb-4">
      <p className="mb-2 text-sm font-medium">Albums</p>
      <div className="space-y-2">
        {regularAlbums.map((album) => {
          const checked = photo.albumIds?.includes(album.id) ?? false;
          return (
            <label
              key={album.id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={pending !== null}
                onChange={() => void toggle(album)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span>{album.name}</span>
            </label>
          );
        })}
      </div>
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
