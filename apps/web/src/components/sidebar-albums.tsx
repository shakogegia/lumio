"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Folder as FolderIcon, Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { NavLink, type NavItem } from "@/components/sidebar-nav-link";
import { useLibraryTree } from "@/components/library-tree/library-tree";
import { buildAlbumTree, type AlbumTreeNode } from "@/lib/library-tree-rows";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";

function AlbumRow({ album }: { album: AlbumSummaryDTO }) {
  const { slug } = useCatalog();
  return (
    <Link
      href={catalogPath(slug, `/albums/${album.id}`)}
      prefetch={false}
      className="flex items-center gap-2 rounded-md p-1.5 text-sm transition-colors hover:bg-muted"
    >
      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {album.coverPhotoId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={catalogApiUrl(slug, `/photos/${album.coverPhotoId}/thumbnail`)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <Images className="size-3.5 text-muted-foreground" />
        )}
      </span>
      <span className="truncate">{album.name}</span>
    </Link>
  );
}

/** A folder row; if it has children it nests its contents in a hover submenu. */
function FolderNode({ node }: { node: AlbumTreeNode }) {
  const { slug } = useCatalog();
  const hasChildren = node.folders.length > 0 || node.albums.length > 0;
  const row = (
    <Link
      href={catalogPath(slug, `/albums/folder/${node.id}/photos`)}
      prefetch={false}
      className="flex items-center gap-2 rounded-md p-1.5 text-sm transition-colors hover:bg-muted"
    >
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate font-medium">{node.name}</span>
      {hasChildren && (
        <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </Link>
  );
  if (!hasChildren) return row;
  return (
    <HoverCard openDelay={80} closeDelay={100}>
      <HoverCardTrigger asChild>{row}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={4}
        className="max-h-[360px] w-60 overflow-y-auto p-1"
      >
        <ul role="list">
          {node.folders.map((f) => (
            <li key={f.id}>
              <FolderNode node={f} />
            </li>
          ))}
          {node.albums.map((a) => (
            <li key={a.id}>
              <AlbumRow album={a} />
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * The Albums nav flyout: the full folder/album tree as nested hover submenus
 * (folders expand to the side on hover), reading the shared LibraryTreeProvider.
 */
export function SidebarAlbums({ item, active }: { item: NavItem; active: boolean }) {
  const { folders, albums } = useLibraryTree();
  const [open, setOpen] = useState(false);

  const tree = buildAlbumTree(folders, albums, {
    includeSmart: true,
    includeEmptyFolders: true,
  });
  const hasContent = tree.albums.length > 0 || tree.folders.length > 0;

  return (
    <HoverCard
      open={open && hasContent}
      onOpenChange={setOpen}
      openDelay={120}
      closeDelay={100}
    >
      <HoverCardTrigger asChild>
        <NavLink item={item} active={active} />
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        sideOffset={8}
        className="max-h-[360px] w-60 overflow-y-auto p-1"
      >
        <ul role="list">
          {tree.folders.map((f) => (
            <li key={f.id}>
              <FolderNode node={f} />
            </li>
          ))}
          {tree.albums.map((a) => (
            <li key={a.id}>
              <AlbumRow album={a} />
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
