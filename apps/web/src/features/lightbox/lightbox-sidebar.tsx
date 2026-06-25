"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, Search, X } from "lucide-react";
import type { AlbumSummaryDTO, PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { exifEntries, filterExifEntries } from "@/lib/exif-entries";
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
import { LightboxEditPanel } from "@/features/photo-editor";
import { LightboxTab } from "@/lib/lightbox-tab";
import { FeatureKey } from "@lumio/shared";
import { FeatureGate } from "@/components/features/features-provider";
import { MetadataPanel } from "./metadata-panel";
import { StandardMetadata } from "./standard-metadata";

export function LightboxSidebar({ photo }: { photo: PhotoDTO }) {
  // Controlled by the shared collection state so the i/e keyboard shortcuts can
  // drive the tab from the lightbox-level keyboard handler.
  const { openTab, setOpenTab } = usePhotoCollection();
  const metadata = exifEntries(photo.exif);

  return (
    <aside className="w-full shrink-0 border-t bg-background text-sm lg:flex lg:h-dvh lg:w-80 lg:flex-col lg:overflow-hidden lg:border-t-0 lg:border-l">
      <Tabs
        value={openTab}
        onValueChange={(v) => setOpenTab(v as LightboxTab)}
        className="gap-0 lg:min-h-0 lg:flex-1"
      >
        <div className="flex shrink-0 items-center border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value={LightboxTab.Info}>
              Info
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">i</Kbd>
            </TabsTrigger>
            <TabsTrigger value={LightboxTab.Edit}>
              Edit
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">e</Kbd>
            </TabsTrigger>
            <TabsTrigger value={LightboxTab.Exif}>EXIF</TabsTrigger>
          </TabsList>
        </div>

        <div className="p-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto">
          <TabsContent value={LightboxTab.Info} className="space-y-4">
            <StandardMetadata exif={photo.exif} />
            <Separator />
            <div className="space-y-3">
              <Row label="Source" value={<Badge>{photo.source}</Badge>} />
              <Row label="File created" value={photo.fileCreatedAt ?? "—"} />
              <Row label="File modified" value={photo.fileModifiedAt ?? "—"} />
              <Row label="Hash" value={photo.hash ?? "—"} />
            </div>
            <FeatureGate feature={FeatureKey.Metadata}>
              <Separator />
              <MetadataPanel key={photo.id} photo={photo} />
            </FeatureGate>
            <Separator />
            {/* Keyed on photo.id so membership re-initializes per photo during
              arrow-key navigation. */}
            <AlbumMembership key={photo.id} photo={photo} />
          </TabsContent>

          <TabsContent value={LightboxTab.Edit} className="lg:flex lg:flex-col">
            <LightboxEditPanel />
          </TabsContent>

          <TabsContent value={LightboxTab.Exif}>
            <ExifPanel entries={metadata} />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

function AlbumMembership({ photo }: { photo: PhotoDTO }) {
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
            // Match the album-picker DropdownMenuItem 1:1 (gap-2.5, rounded-xl,
            // px-3 py-2, text-sm, accent hover) so the lightbox list and the
            // "Add more" menu read as the same control.
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
        <p className="text-xs text-muted-foreground">
          No metadata matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <dl className="space-y-1 text-xs">
          {filtered.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-all text-right font-mono">
                {value}
              </dd>
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
