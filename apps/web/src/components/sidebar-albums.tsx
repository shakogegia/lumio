"use client";

import { useState } from "react";
import Link from "next/link";
import { Folder as FolderIcon, Images } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { NavLink, type NavItem } from "@/components/sidebar-nav-link";
import { useLibraryTree } from "@/components/library-tree/library-tree";
import { buildAlbumPickerRows } from "@/lib/library-tree-rows";

const INDENT = 12;

/**
 * The Albums nav flyout: the full folder/album tree in the same compact, indented
 * style as the "Add to album" picker, but every row is a navigation link. Reads the
 * shared LibraryTreeProvider, so it shares one prefetched copy with the pickers.
 */
export function SidebarAlbums({ item, active }: { item: NavItem; active: boolean }) {
  const { folders, albums } = useLibraryTree();
  const [open, setOpen] = useState(false);

  const rows = buildAlbumPickerRows(folders, albums, {
    includeSmart: true,
    includeEmptyFolders: true,
  });

  return (
    <HoverCard
      open={open && rows.length > 0}
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
        className="max-h-[360px] w-64 overflow-y-auto p-1"
      >
        <ul role="list">
          {rows.map((row) =>
            row.kind === "folder" ? (
              <li key={`f:${row.id}`}>
                <Link
                  href={`/albums/folder/${row.id}/photos`}
                  prefetch={false}
                  className="flex items-center gap-2 rounded-md py-1.5 text-sm transition-colors hover:bg-muted"
                  style={{ paddingLeft: 8 + row.depth * INDENT, paddingRight: 8 }}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate font-medium">{row.name}</span>
                </Link>
              </li>
            ) : (
              <li key={`a:${row.album.id}`}>
                <Link
                  href={`/albums/${row.album.id}`}
                  prefetch={false}
                  className="flex items-center gap-2 rounded-md py-1 text-sm transition-colors hover:bg-muted"
                  style={{ paddingLeft: 8 + row.depth * INDENT, paddingRight: 8 }}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {row.album.coverPhotoId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/thumbnails/${row.album.coverPhotoId}`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Images className="size-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="truncate">{row.album.name}</span>
                </Link>
              </li>
            ),
          )}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
