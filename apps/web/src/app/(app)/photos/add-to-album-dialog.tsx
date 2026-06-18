"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function AddToAlbumDialog({
  open,
  onOpenChange,
  photoIds,
  onAdded,
  excludeAlbumId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoIds: string[];
  /** Called after photos are successfully added (close + clear selection). */
  onAdded: () => void;
  /** Hide this album from the list (e.g. the album you're already viewing). */
  excludeAlbumId?: string;
}) {
  const router = useRouter();
  const [albums, setAlbums] = useState<AlbumSummaryDTO[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAlbums(null);
    setLoadError(false);
    setNewName("");
    setError(null);
    fetch("/api/albums")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: { items: AlbumSummaryDTO[] }) =>
        setAlbums(data.items.filter((a) => !a.isSmart && a.id !== excludeAlbumId)),
      )
      .catch(() => setLoadError(true));
  }, [open, excludeAlbumId]);

  async function postPhotos(albumId: string) {
    const res = await fetch(`/api/albums/${albumId}/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds }),
    });
    if (!res.ok) throw new Error("add failed");
  }

  async function handlePick(albumId: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await postPhotos(albumId);
      router.refresh();
      onAdded();
    } catch {
      setError("Failed to add photos to the album.");
    } finally {
      setPending(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, isSmart: false }),
      });
      if (!res.ok) throw new Error();
      const album = (await res.json()) as { id: string };
      await postPhotos(album.id);
      router.refresh();
      onAdded();
    } catch {
      setError("Failed to create the album.");
    } finally {
      setPending(false);
    }
  }

  const photoLabel = `${photoIds.length} ${photoIds.length === 1 ? "photo" : "photos"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {photoLabel} to album</DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => void handleCreate(e)} className="flex gap-2">
          <Input
            placeholder="New album from selection"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending || newName.trim() === ""}>
            Create
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loadError && (
            <p className="px-2 py-4 text-sm text-muted-foreground">Failed to load albums.</p>
          )}
          {albums === null && !loadError && (
            <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
          )}
          {albums?.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No albums yet — create one above.
            </p>
          )}
          {albums?.map((album) => (
            <button
              key={album.id}
              type="button"
              disabled={pending}
              onClick={() => void handlePick(album.id)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted disabled:opacity-50"
            >
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {album.coverPhotoId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/thumbnails/${album.coverPhotoId}`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Images className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{album.name}</p>
                <p className="text-xs text-muted-foreground">
                  {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
                </p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
