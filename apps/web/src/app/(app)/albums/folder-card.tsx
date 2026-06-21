"use client";

import { Folder as FolderIcon, FolderInput, FolderOpen, Images, Pencil, Trash2 } from "lucide-react";
import type { FolderSummaryDTO } from "@lumio/shared";
import { SelectionRing } from "@/components/photo-grid/selection-ring";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/**
 * One folder in the listing grid. Plain left click toggles selection; double click
 * opens it; ⌘/Ctrl/middle click falls through to the native link (new tab).
 * Right click opens a context menu (open / view photos / rename / move / delete);
 * move + delete are selection-aware (resolved by the caller's handlers).
 */
export function FolderCard({
  folder,
  isSelected,
  onToggle,
  onOpen,
  onViewPhotos,
  onRename,
  onMove,
  onDelete,
}: {
  folder: FolderSummaryDTO;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onViewPhotos: (id: string) => void;
  onRename: (id: string) => void;
  onMove: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const previews = folder.previewPhotoIds;
  const cover = (
    <div className="relative grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-sm bg-muted">
      {previews.length === 0 ? (
        <div className="col-span-2 row-span-2 flex items-center justify-center">
          <FolderIcon className="size-8 text-muted-foreground" />
        </div>
      ) : (
        Array.from({ length: 4 }).map((_, i) =>
          previews[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={previews[i]}
              src={`/api/thumbnails/${previews[i]}`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div key={i} className="bg-muted" />
          ),
        )
      )}
    </div>
  );

  const parts = [`${folder.albumCount} ${folder.albumCount === 1 ? "album" : "albums"}`];
  if (folder.totalPhotoCount > 0) {
    parts.push(`${folder.totalPhotoCount} ${folder.totalPhotoCount === 1 ? "photo" : "photos"}`);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          href={`/albums/folder/${folder.id}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.button !== 0) return;
            e.preventDefault();
            onToggle(folder.id);
          }}
          onDoubleClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpen(folder.id);
          }}
          className="group block select-none"
        >
          <div className="relative rounded-sm">
            {cover}
            {isSelected && <SelectionRing className="rounded-sm" />}
          </div>
          <div className="mt-2.5">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {folder.name}
            </p>
            <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>
          </div>
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onOpen(folder.id)}>
          <FolderOpen aria-hidden />
          Open
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onViewPhotos(folder.id)}>
          <Images aria-hidden />
          View all photos
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRename(folder.id)}>
          <Pencil aria-hidden />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onMove(folder.id)}>
          <FolderInput aria-hidden />
          Move to…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(folder.id)}>
          <Trash2 aria-hidden />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
