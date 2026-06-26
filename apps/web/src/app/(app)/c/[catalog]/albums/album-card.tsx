"use client";

import { useState } from "react";
import { FolderInput, Images, Pencil, SlidersHorizontal, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
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
import { EditRulesDialog } from "./edit-rules-dialog";

/**
 * One album in the listing grid. Plain left click selects only it; ⌘ (Mac) /
 * Ctrl (Windows) click toggles it into a multi-selection; shift click extends a
 * range; double click opens it; middle click opens the native link (new tab).
 * Right click opens a context menu (open / rename / move / delete); move + delete
 * are selection-aware (resolved by the caller's handlers).
 */
export function AlbumCard({
  album,
  isSelected,
  onSelect,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  album: AlbumSummaryDTO;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onRename: (id: string) => void;
  onMove: (id: string, targetFolderId: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const { slug } = useCatalog();
  const [editOpen, setEditOpen] = useState(false);
  const cover = (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm bg-muted">
      {album.coverPhotoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={catalogApiUrl(slug, `/photos/${album.coverPhotoId}/thumbnail`)}
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
        {countLabel(album.photoCount, "photo", "photos")}
      </p>
    </div>
  );

  return (
    <>
      {album.isSmart && (
        <EditRulesDialog
          albumId={album.id}
          initial={album.rules}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <a
            href={catalogPath(slug, `/albums/${album.id}`)}
            data-card-id={album.id}
            onClick={(e) => {
              // Middle/aux click opens the native link (new tab); every left click
              // selects: plain = only this, ⌘/Ctrl = toggle, shift = range.
              if (e.button !== 0) return;
              e.preventDefault();
              onSelect(album.id, e);
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
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2.5">
              <FolderInput aria-hidden />
              Move to…
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
              <MovePickerItems Item={ContextMenuItem} onPick={(target) => onMove(album.id, target)} />
            </ContextMenuSubContent>
          </ContextMenuSub>
          {album.isSmart && (
            <ContextMenuItem onSelect={() => setEditOpen(true)}>
              <SlidersHorizontal aria-hidden />
              Edit rules
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(album.id)}>
            <Trash2 aria-hidden />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}
