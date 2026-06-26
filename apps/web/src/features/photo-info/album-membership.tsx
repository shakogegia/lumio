"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import type { AlbumSummaryDTO, PhotoDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useLibraryTree } from "@/components/library-tree/library-tree";
import {
  AlbumPickerItems,
  AlbumThumb,
} from "@/components/photo-actions/album-picker-items";
import { useAddToAlbum } from "@/components/photo-actions/use-add-to-album";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { removePhotoFromAlbum } from "@/lib/photo-mutations";
import { usePhotoCollection } from "@/features/photo-grid";

/** "Appears in" — the photo's album membership, with inline add/remove. Loads
 *  the photo's full DTO to learn membership (grid photos carry no albumIds). */
export function AlbumMembership({ photo }: { photo: PhotoDTO }) {
  const { slug } = useCatalog();
  const { patchPhotos } = usePhotoCollection();
  const { albums, loading: treeLoading } = useLibraryTree();
  const { addToAlbum, addToAlbumDirect, element } = useAddToAlbum();
  const [pending, setPending] = useState(false);
  // Null until the photo's full DTO loads (the grid photo carries no albumIds).
  const [albumIds, setAlbumIds] = useState<string[] | null>(
    photo.albumIds ?? null,
  );

  // Learn this photo's current membership.
  useEffect(() => {
    let alive = true;
    fetch(catalogApiUrl(slug, `/photos/${photo.id}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.url}`))))
      .then((data: PhotoDTO) => {
        if (alive) setAlbumIds(data.albumIds ?? []);
      })
      .catch(() => {
        /* leave membership unknown on failure */
      });
    return () => {
      alive = false;
    };
  }, [slug, photo.id]);

  // Re-read membership from the server and sync the grid store. Used after the
  // "New album…" dialog adds the photo (the dialog doesn't return the new id).
  const resync = useCallback(() => {
    fetch(catalogApiUrl(slug, `/photos/${photo.id}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.url}`))))
      .then((data: PhotoDTO) => {
        const next = data.albumIds ?? [];
        setAlbumIds(next);
        patchPhotos(new Set([photo.id]), { albumIds: next });
      })
      .catch(() => {
        /* leave membership as-is on failure */
      });
  }, [slug, photo.id, patchPhotos]);

  // Add to an existing album via the shared quick-pick (POST + sound + refresh),
  // then optimistically reflect it locally and in the grid store.
  function add(albumId: string) {
    // `next` is captured from this render's albumIds. Safe: the dropdown closes
    // after every pick, so the next "Add more" open re-renders with fresh state
    // before another add can be issued.
    const next = [...(albumIds ?? []), albumId];
    void addToAlbumDirect([photo.id], albumId, {
      onSuccess: () => {
        setAlbumIds(next);
        patchPhotos(new Set([photo.id]), { albumIds: next });
      },
    });
  }

  async function remove(albumId: string) {
    if (pending) return;
    const next = (albumIds ?? []).filter((id) => id !== albumId);
    setPending(true);
    try {
      await removePhotoFromAlbum(slug, albumId, photo.id);
      // Only commit once the server confirms, so a failed delete can't leave
      // phantom membership in the UI or the shared grid store.
      setAlbumIds(next);
      patchPhotos(new Set([photo.id]), { albumIds: next });
    } catch {
      toast.error("Failed to update album.");
    } finally {
      setPending(false);
    }
  }

  const byId = new Map(albums.map((a) => [a.id, a]));
  const memberAlbums = (albumIds ?? [])
    .map((id) => byId.get(id))
    .filter((a): a is AlbumSummaryDTO => a !== undefined && !a.isSmart)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Skeleton while membership is unknown, or while a photo known to be in some
  // albums waits for the tree to resolve their names. An empty membership needs
  // no tree, so it shows the empty state immediately.
  const loading =
    albumIds === null ||
    (albumIds.length > 0 && treeLoading && albums.length === 0);

  return (
    <div>
      <p className="mb-2 font-medium">Appears in</p>
      {loading ? (
        <div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2">
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="h-4 w-32 rounded" />
            </div>
          ))}
        </div>
      ) : memberAlbums.length === 0 ? (
        <p className="text-muted-foreground">Not in any album yet</p>
      ) : (
        <div>
          {memberAlbums.map((album) => (
            <div
              key={album.id}
              className="group/row relative flex cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors select-none hover:bg-accent hover:text-accent-foreground"
            >
              <AlbumThumb coverPhotoId={album.coverPhotoId} />
              <span className="truncate">{album.name}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => void remove(album.id)}
                aria-label={`Remove from ${album.name}`}
                className="-mr-1 ml-auto rounded-md p-1 text-muted-foreground opacity-0 transition hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={albumIds === null}
            className="mt-2 w-full"
          >
            <Plus aria-hidden />
            Add more
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <AlbumPickerItems
            menu={{
              Item: DropdownMenuItem,
              Separator: DropdownMenuSeparator,
              Sub: DropdownMenuSub,
              SubTrigger: DropdownMenuSubTrigger,
              SubContent: DropdownMenuSubContent,
            }}
            excludeAlbumIds={new Set(albumIds ?? [])}
            onPick={(albumId) => add(albumId)}
            onCreateNew={() => addToAlbum([photo.id], { onSuccess: resync })}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {element}
    </div>
  );
}
