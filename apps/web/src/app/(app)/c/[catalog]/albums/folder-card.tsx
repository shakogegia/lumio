"use client";

import { Folder as FolderIcon, FolderInput, FolderOpen, Images, Pencil, Trash2 } from "lucide-react";
import type { FolderSummaryDTO } from "@lumio/shared";
import { countLabel } from "@/lib/count-label";
import { SelectionRing } from "@/features/photo-grid";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MovePickerItems } from "./move-picker-items";

/**
 * One folder in the listing grid. Plain left click selects only it; ⌘ (Mac) /
 * Ctrl (Windows) click toggles it into a multi-selection; shift click extends a
 * range; double click opens it; middle click opens the native link (new tab).
 * Right click opens a context menu (open / view photos / rename / move / delete);
 * move + delete are selection-aware (resolved by the caller's handlers).
 */
export function FolderCard({
  folder,
  isSelected,
  onSelect,
  onOpen,
  onViewPhotos,
  onRename,
  onMove,
  onDelete,
}: {
  folder: FolderSummaryDTO;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onViewPhotos: (id: string) => void;
  onRename: (id: string) => void;
  onMove: (id: string, targetFolderId: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const { slug } = useCatalog();
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
              src={catalogApiUrl(slug, `/photos/${previews[i]}/thumbnail`)}
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

  const parts = [countLabel(folder.albumCount, "album", "albums")];
  if (folder.totalPhotoCount > 0) {
    parts.push(countLabel(folder.totalPhotoCount, "photo", "photos"));
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          href={catalogPath(slug, `/albums/folder/${folder.id}`)}
          data-card-id={folder.id}
          onClick={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            onSelect(folder.id, e);
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
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2.5">
            <FolderInput aria-hidden />
            Move to…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
            <MovePickerItems
              Item={ContextMenuItem}
              excludeSubtreeOf={folder.id}
              onPick={(target) => onMove(folder.id, target)}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(folder.id)}>
          <Trash2 aria-hidden />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
