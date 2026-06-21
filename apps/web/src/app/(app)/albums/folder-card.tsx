"use client";

import { Folder as FolderIcon } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { FolderSummaryDTO } from "@lumio/shared";
import { SelectionRing } from "@/components/photo-grid/selection-ring";
import { cn } from "@/lib/utils";

export function FolderCard({
  folder,
  isSelected,
  onToggle,
  onOpen,
}: {
  folder: FolderSummaryDTO;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const draggable = useDraggable({ id: `album-or-folder:${folder.id}`, data: { type: "folder", id: folder.id } });
  const droppable = useDroppable({ id: `drop:${folder.id}`, data: { type: "folder", id: folder.id } });
  const setRefs = (el: HTMLElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };

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
    <a
      ref={setRefs}
      {...draggable.listeners}
      {...draggable.attributes}
      draggable={false}
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
      className={cn(
        "group block select-none rounded-sm",
        droppable.isOver && "outline outline-2 outline-primary outline-offset-2",
        draggable.isDragging && "opacity-40",
      )}
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
  );
}
