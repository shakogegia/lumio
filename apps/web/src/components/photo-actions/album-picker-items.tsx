"use client";

import { useEffect, useState } from "react";
import { Images, Plus } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";

/** Menu-item / separator components from whichever menu family hosts the list
 *  (context-menu or dropdown-menu — their item props are compatible). */
type ItemComponent = React.ComponentType<{
  onSelect?: (event: Event) => void;
  className?: string;
  children?: React.ReactNode;
}>;
type SeparatorComponent = React.ComponentType<{ className?: string }>;

/**
 * The album list rendered inside a menu: every (non-smart) album as a quick-pick
 * item, then a "New album…" item that hands off to the create dialog. Fetches on
 * mount, so it loads when the submenu/dropdown opens. Family-agnostic — pass the
 * host menu's `Item`/`Separator` so the same list works in the right-click
 * context menu and the toolbar dropdown.
 */
export function AlbumPickerItems({
  Item,
  Separator,
  excludeAlbumId,
  onPick,
  onCreateNew,
}: {
  Item: ItemComponent;
  Separator: SeparatorComponent;
  excludeAlbumId?: string;
  onPick: (albumId: string) => void;
  onCreateNew: () => void;
}) {
  const [albums, setAlbums] = useState<AlbumSummaryDTO[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/albums")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: { items: AlbumSummaryDTO[] }) => {
        if (!cancelled) {
          setAlbums(data.items.filter((a) => !a.isSmart && a.id !== excludeAlbumId));
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [excludeAlbumId]);

  const status =
    error
      ? "Failed to load albums."
      : albums === null
        ? "Loading…"
        : albums.length === 0
          ? "No albums yet."
          : null;

  return (
    <>
      {status && <div className="px-3 py-2 text-sm text-muted-foreground">{status}</div>}
      {albums?.map((album) => (
        <Item key={album.id} onSelect={() => onPick(album.id)}>
          <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {album.coverPhotoId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/thumbnails/${album.coverPhotoId}`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <Images className="size-3.5 text-muted-foreground" />
            )}
          </span>
          <span className="truncate">{album.name}</span>
        </Item>
      ))}
      <Separator />
      <Item onSelect={() => onCreateNew()}>
        <Plus aria-hidden />
        New album…
      </Item>
    </>
  );
}
