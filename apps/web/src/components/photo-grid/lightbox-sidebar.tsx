"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Download, Search } from "lucide-react";
import { hasEdits } from "@lumio/shared";
import type { AlbumSummaryDTO, PhotoDTO } from "@lumio/shared";
import { downloadFromUrl } from "@/lib/download-client";
import { DownloadSplitButton } from "@/components/photo-actions/download-split-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useConfirm } from "@/components/confirm-dialog";
import { exifEntries, filterExifEntries } from "@/lib/exif-entries";
import { usePhotoCollection } from "./photo-collection";
import { LightboxEditPanel } from "./lightbox-edit-panel";

export function LightboxSidebar({
  photo,
  onTrashed,
}: {
  photo: PhotoDTO;
  onTrashed: () => void;
}) {
  const { removePhotos } = usePhotoCollection();
  const { confirm, confirmDialog } = useConfirm();
  const filename = photo.path.split("/").pop() || photo.path;
  const camera =
    [photo.exif.cameraMake, photo.exif.cameraModel].filter(Boolean).join(" ") ||
    "—";
  const metadata = exifEntries(photo.exif);

  // The store's grid photo carries no album list, so fetch the catalog of
  // regular (non-smart) albums client-side once.
  const [regularAlbums, setRegularAlbums] = useState<AlbumSummaryDTO[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/albums")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: { items: AlbumSummaryDTO[] }) => {
        if (alive) setRegularAlbums(data.items.filter((a) => !a.isSmart));
      })
      .catch(() => {
        /* leave the album list empty on failure */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function trash() {
    const ok = await confirm({
      title: "Move to Trash?",
      description: "You can restore it later.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch("/api/photos/trash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [photo.id] }),
    });
    if (!res.ok) {
      toast.error("Failed to move to Trash.");
      return;
    }
    removePhotos(new Set([photo.id]));
    onTrashed();
  }

  return (
    <aside className="w-full shrink-0 border-t bg-background p-4 text-sm lg:h-dvh lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
      {confirmDialog}
      <div className="space-y-1">
        <h2 className="font-medium break-all">{filename}</h2>
        <p className="text-muted-foreground">
          {photo.width}×{photo.height}
        </p>
      </div>

      <Tabs defaultValue="info" className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="exif">EXIF</TabsTrigger>
          <TabsTrigger value="edit">Edit</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4">
          <div className="space-y-3">
            <Row label="Source" value={<Badge>{photo.source}</Badge>} />
            <Row label="Taken" value={photo.takenAt ?? "—"} />
            <Row label="Camera" value={camera} />
            <Row label="Hash" value={photo.hash ?? "—"} />
          </div>
          {regularAlbums.length > 0 && (
            <>
              <Separator />
              {/* Keyed on photo.id so membership state re-initializes to null on
                  each photo: a toggle during arrow-nav can't compute nextIds from
                  the previous photo's membership. The album LIST fetch stays in
                  the parent, so it isn't re-fetched per navigation. */}
              <AlbumMembership key={photo.id} photo={photo} regularAlbums={regularAlbums} />
            </>
          )}
          <Separator />
          <div className="space-y-2">
            {hasEdits(photo.edits) ? (
              <DownloadSplitButton
                onDownloadEdited={() => downloadFromUrl(`/api/photos/${photo.id}/edited?download=1`)}
                onDownloadOriginal={() => downloadFromUrl(`/api/photos/${photo.id}/original?download=1`)}
              />
            ) : (
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={`/api/photos/${photo.id}/original?download=1`}>
                  <Download aria-hidden />
                  Download
                </a>
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => void trash()}
            >
              Move to Trash
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="exif">
          <ExifPanel entries={metadata} />
        </TabsContent>

        <TabsContent value="edit">
          <LightboxEditPanel />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function AlbumMembership({
  photo,
  regularAlbums,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
}) {
  const { patchPhotos } = usePhotoCollection();
  const [pending, setPending] = useState<string | null>(null);
  // The grid's photo has albumIds === undefined; fetch the full DTO to learn
  // membership. Null until loaded so the checkboxes only render once known.
  const [albumIds, setAlbumIds] = useState<string[] | null>(photo.albumIds ?? null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/photos/${photo.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: PhotoDTO) => {
        if (alive) setAlbumIds(data.albumIds ?? []);
      })
      .catch(() => {
        /* leave membership unknown on failure */
      });
    return () => {
      alive = false;
    };
  }, [photo.id]);

  async function toggle(album: AlbumSummaryDTO) {
    const isMember = albumIds?.includes(album.id) ?? false;
    const nextIds = isMember
      ? (albumIds ?? []).filter((id) => id !== album.id)
      : [...(albumIds ?? []), album.id];
    setPending(album.id);
    try {
      const res = isMember
        ? await fetch(`/api/albums/${album.id}/photos/${photo.id}`, {
            method: "DELETE",
          })
        : await fetch(`/api/albums/${album.id}/photos`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ photoIds: [photo.id] }),
          });
      // Only commit the optimistic local + store update once the server confirms
      // (a smart album → 400, a deleted album → 404 would otherwise leave phantom
      // membership in the UI and the shared grid store).
      if (!res.ok) {
        toast.error("Failed to update album.");
        return;
      }
      setAlbumIds(nextIds);
      patchPhotos(new Set([photo.id]), { albumIds: nextIds });
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <p className="mb-2 font-medium">Albums</p>
      <div className="space-y-2">
        {regularAlbums.map((album) => {
          const checked = albumIds?.includes(album.id) ?? false;
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

function ExifPanel({ entries }: { entries: Array<[string, string]> }) {
  const [query, setQuery] = useState("");
  const filtered = filterExifEntries(entries, query);
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search metadata"
          aria-label="Search metadata"
          className="pl-9"
        />
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metadata</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metadata matches &ldquo;{query}&rdquo;.</p>
      ) : (
        <dl className="space-y-1 text-xs">
          {filtered.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-all text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      )}
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
