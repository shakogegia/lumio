"use client";

import { Folder as FolderIcon, Images, Plus } from "lucide-react";
import { useLibraryTree } from "@/components/library-tree/library-tree";
import { buildAlbumPickerRows } from "@/lib/library-tree-rows";

/** Menu-item / separator components from whichever menu family hosts the list
 *  (context-menu or dropdown-menu — their item props are compatible). */
type ItemComponent = React.ComponentType<{
  onSelect?: (event: Event) => void;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}>;
type SeparatorComponent = React.ComponentType<{ className?: string }>;

const INDENT = 12;

/**
 * The album list rendered inside a menu, mirroring the folder hierarchy: top-level
 * albums first, then each folder as a (non-selectable) header with its albums
 * indented beneath, then a "New album…" item. Reads the shared, prefetched
 * LibraryTreeProvider so it opens instantly and stays in sync. Family-agnostic —
 * pass the host menu's `Item`/`Separator` so the same list works in the right-click
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
  const { folders, albums, loading, error } = useLibraryTree();
  const rows = buildAlbumPickerRows(folders, albums, { excludeAlbumId });

  const status = error
    ? "Failed to load albums."
    : loading && albums.length === 0
      ? "Loading…"
      : rows.length === 0
        ? "No albums yet."
        : null;

  return (
    <>
      {status && <div className="px-3 py-2 text-sm text-muted-foreground">{status}</div>}
      {rows.map((row) =>
        row.kind === "folder" ? (
          <div
            key={`f:${row.id}`}
            className="flex items-center gap-1.5 py-1.5 text-xs font-medium text-muted-foreground"
            style={{ paddingLeft: 8 + row.depth * INDENT, paddingRight: 8 }}
          >
            <FolderIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{row.name}</span>
          </div>
        ) : (
          <Item
            key={`a:${row.album.id}`}
            onSelect={() => onPick(row.album.id)}
            style={{ paddingLeft: 8 + row.depth * INDENT }}
          >
            <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              {row.album.coverPhotoId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/thumbnails/${row.album.coverPhotoId}`}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Images className="size-3.5 text-muted-foreground" />
              )}
            </span>
            <span className="truncate">{row.album.name}</span>
          </Item>
        ),
      )}
      <Separator />
      <Item onSelect={() => onCreateNew()}>
        <Plus aria-hidden />
        New album…
      </Item>
    </>
  );
}
