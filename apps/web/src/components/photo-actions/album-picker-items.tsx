"use client";

import { Folder as FolderIcon, Images, Plus } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { useLibraryTree } from "@/components/library-tree/library-tree";
import { buildAlbumTree, type AlbumTreeNode } from "@/lib/library-tree-rows";

/** Menu-family components (context-menu or dropdown-menu — their props are compatible),
 *  so the same nested picker works in the right-click menu and the toolbar dropdown. */
type ItemComponent = React.ComponentType<{
  onSelect?: (event: Event) => void;
  className?: string;
  children?: React.ReactNode;
}>;
export interface AlbumPickerMenu {
  Item: ItemComponent;
  Separator: React.ComponentType<{ className?: string }>;
  Sub: React.ComponentType<{ children?: React.ReactNode }>;
  SubTrigger: React.ComponentType<{ className?: string; children?: React.ReactNode }>;
  SubContent: React.ComponentType<{ className?: string; children?: React.ReactNode }>;
}

/** The square album cover thumbnail (or a fallback icon), shared by the picker
 *  rows and the lightbox "Appears in" list. */
export function AlbumThumb({ coverPhotoId }: { coverPhotoId: string | null }) {
  const { slug } = useCatalog();
  return (
    <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {coverPhotoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={catalogApiUrl(slug, `/photos/${coverPhotoId}/thumbnail`)}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <Images className="size-3.5 text-muted-foreground" />
      )}
    </span>
  );
}

function AlbumOption({
  album,
  Item,
  onPick,
}: {
  album: AlbumSummaryDTO;
  Item: ItemComponent;
  onPick: (albumId: string) => void;
}) {
  return (
    <Item onSelect={() => onPick(album.id)}>
      <AlbumThumb coverPhotoId={album.coverPhotoId} />
      <span className="truncate">{album.name}</span>
    </Item>
  );
}

function FolderSubmenu({
  node,
  menu,
  onPick,
}: {
  node: AlbumTreeNode;
  menu: AlbumPickerMenu;
  onPick: (albumId: string) => void;
}) {
  const { Item, Sub, SubTrigger, SubContent } = menu;
  return (
    <Sub>
      <SubTrigger className="gap-2.5">
        <FolderIcon aria-hidden />
        <span className="truncate">{node.name}</span>
      </SubTrigger>
      <SubContent className="max-h-72 w-56 overflow-y-auto">
        {node.folders.map((f) => (
          <FolderSubmenu key={f.id} node={f} menu={menu} onPick={onPick} />
        ))}
        {node.albums.map((a) => (
          <AlbumOption key={a.id} album={a} Item={Item} onPick={onPick} />
        ))}
      </SubContent>
    </Sub>
  );
}

/**
 * The album list rendered inside a menu as a true nested submenu tree: top-level
 * albums as items, each folder as a hover-to-expand submenu of its albums + child
 * folders, then "New album…". Reads the shared, prefetched LibraryTreeProvider.
 */
export function AlbumPickerItems({
  menu,
  excludeAlbumId,
  excludeAlbumIds,
  onPick,
  onCreateNew,
}: {
  menu: AlbumPickerMenu;
  excludeAlbumId?: string;
  excludeAlbumIds?: Set<string>;
  onPick: (albumId: string) => void;
  onCreateNew: () => void;
}) {
  const { folders, albums, loading, error } = useLibraryTree();
  const tree = buildAlbumTree(folders, albums, { excludeAlbumId, excludeAlbumIds });
  const { Item, Separator } = menu;

  const isEmpty = tree.albums.length === 0 && tree.folders.length === 0;
  const status = error
    ? "Failed to load albums."
    : loading && albums.length === 0
      ? "Loading…"
      : isEmpty
        ? "No albums yet."
        : null;

  return (
    <>
      {status && <div className="px-3 py-2 text-sm text-muted-foreground">{status}</div>}
      {tree.folders.map((f) => (
        <FolderSubmenu key={f.id} node={f} menu={menu} onPick={onPick} />
      ))}
      {tree.albums.map((a) => (
        <AlbumOption key={a.id} album={a} Item={Item} onPick={onPick} />
      ))}
      <Separator />
      <Item onSelect={() => onCreateNew()}>
        <Plus aria-hidden />
        New album…
      </Item>
    </>
  );
}
