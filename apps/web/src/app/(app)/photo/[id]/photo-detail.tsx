"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AlbumSummaryDTO, PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export function PhotoDetail({
  photo,
  regularAlbums,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
}) {
  const filename = photo.path.split("/").pop() || photo.path;
  const camera =
    [photo.exif.cameraMake, photo.exif.cameraModel].filter(Boolean).join(" ") ||
    "—";

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/photos/${photo.id}/display`}
          alt={photo.path}
          className="max-h-[80vh] w-full rounded-lg object-contain"
        />
      </div>
      <aside className="w-full shrink-0 border-t pt-6 text-sm lg:w-80 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
        <div className="space-y-1">
          <h2 className="font-medium break-all">{filename}</h2>
          <div className="flex items-center gap-2">
            <Badge>{photo.source}</Badge>
            <span className="text-muted-foreground">
              {photo.width}×{photo.height}
            </span>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="space-y-3">
          <Row label="Taken" value={photo.takenAt ?? "—"} />
          <Row label="Camera" value={camera} />
          <Row label="Hash" value={photo.hash ?? "—"} />
        </div>

        {regularAlbums.length > 0 && (
          <>
            <Separator className="my-4" />
            <AlbumMembership photo={photo} regularAlbums={regularAlbums} />
          </>
        )}

        <Separator className="my-4" />

        <details className="group">
          <summary className="cursor-pointer text-muted-foreground select-none">
            Show all EXIF
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(photo.exif, null, 2)}
          </pre>
        </details>
      </aside>
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
          body: JSON.stringify({ photoId: photo.id }),
        });
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <p className="mb-2 font-medium">Albums</p>
      <div className="space-y-2">
        {regularAlbums.map((album) => {
          const checked = photo.albumIds?.includes(album.id) ?? false;
          return (
            <label
              key={album.id}
              className="flex cursor-pointer items-center gap-2"
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
