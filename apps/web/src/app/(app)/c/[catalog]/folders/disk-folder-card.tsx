"use client";

import { Folder as FolderIcon } from "lucide-react";
import { SelectionRing } from "@/features/photo-grid";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { folderSubtitle } from "@/lib/folder-subtitle";
import type { FolderSummary } from "@/lib/server/catalog-fs-service";

/**
 * One disk folder in the /folders listing — album-style: a 2×2 cover mosaic (or a
 * folder icon when empty), the folder name, and a "{n} folders · {m} photos"
 * subtitle. Plain left click selects only it; ⌘/Ctrl click toggles a
 * multi-selection; shift click extends a range; double click opens it; middle
 * click opens the native link (new tab). Mirrors /albums' FolderCard.
 */
export function DiskFolderCard({
  slug,
  folder,
  isSelected,
  onSelect,
  onOpen,
}: {
  slug: string;
  folder: FolderSummary;
  isSelected: boolean;
  onSelect: (rel: string, e: React.MouseEvent) => void;
  onOpen: (rel: string) => void;
}) {
  const previews = folder.previewPhotoIds;
  return (
    <a
      href={`${catalogPath(slug, "/folders")}?path=${encodeURIComponent(folder.rel)}`}
      data-card-id={folder.rel}
      onClick={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        onSelect(folder.rel, e);
      }}
      onDoubleClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(folder.rel);
      }}
      className="group block select-none"
    >
      <div className="relative rounded-sm">
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
        {isSelected && <SelectionRing className="rounded-sm" />}
      </div>
      <div className="mt-2.5">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {folder.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {folderSubtitle(folder.subfolderCount, folder.photoCount)}
        </p>
      </div>
    </a>
  );
}
