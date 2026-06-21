"use client";

import { FolderInput, Images, Pencil, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { SelectionRing } from "@/components/photo-grid/selection-ring";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/**
 * One album in the listing grid. Plain left click toggles selection; double click
 * opens it; ⌘/Ctrl/middle click falls through to the native link (new tab).
 * Right click opens a context menu (open / rename / move / delete); move + delete
 * are selection-aware (resolved by the caller's handlers).
 */
export function AlbumCard({
  album,
  isSelected,
  onToggle,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  album: AlbumSummaryDTO;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string) => void;
  onMove: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const cover = (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm bg-muted">
      {album.coverPhotoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/thumbnails/${album.coverPhotoId}`}
          alt={album.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <Images className="size-8 text-muted-foreground" />
      )}
    </div>
  );

  const meta = (
    <div className="mt-2.5">
      <p className="truncate text-sm font-semibold">{album.name}</p>
      <p className="text-xs text-muted-foreground">
        {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
      </p>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          href={`/albums/${album.id}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.button !== 0) return;
            e.preventDefault();
            onToggle(album.id);
          }}
          onDoubleClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpen(album.id);
          }}
          className="group block select-none"
        >
          <div className="relative rounded-sm">
            {cover}
            {isSelected && <SelectionRing className="rounded-sm" />}
          </div>
          {meta}
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onOpen(album.id)}>
          <SquareArrowOutUpRight aria-hidden />
          Open
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRename(album.id)}>
          <Pencil aria-hidden />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onMove(album.id)}>
          <FolderInput aria-hidden />
          Move to…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(album.id)}>
          <Trash2 aria-hidden />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
