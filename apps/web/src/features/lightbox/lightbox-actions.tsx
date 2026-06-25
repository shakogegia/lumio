"use client";

import { Download, Heart, Palette, Trash2 } from "lucide-react";
import { hasEdits, type PhotoDTO } from "@lumio/shared";
import { downloadFromUrl } from "@/lib/download-client";
import { catalogApiUrl } from "@/lib/catalog-api";
import { optimisticTrash } from "@/lib/trash-optimistic";
import { useCatalog } from "@/components/providers/catalog-context";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/confirm-dialog";
import { usePhotoCollection, useToggleFavorite } from "@/features/photo-grid";
import { useEditSession } from "@/features/photo-editor";
import { usePhotoCapabilities } from "@/components/photo-actions/photo-capabilities";

/** Icon-button row for the lightbox header: reset edits (when edited),
 *  favorite, download, move to trash. */
export function LightboxActions({
  photo,
  onTrashed,
}: {
  photo: PhotoDTO;
  onTrashed: () => void;
}) {
  const { slug } = useCatalog();
  const { removePhotos, reload } = usePhotoCollection();
  const { confirm, confirmDialog } = useConfirm();
  const { dirty, reset } = useEditSession();
  const toggleFavorite = useToggleFavorite(photo);
  const caps = usePhotoCapabilities();
  // Edited = unsaved working changes, or persisted edits baked into the photo.
  const edited = dirty || hasEdits(photo.edits);

  function trash() {
    optimisticTrash({
      slug,
      ids: [photo.id],
      removePhotos,
      reload,
      onRemoved: onTrashed,
    });
  }

  async function resetEdits() {
    const ok = await confirm({
      title: "Reset edits?",
      description:
        "Revert this photo to its original. Apply afterwards to save the change.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    reset();
  }

  return (
    <>
      {confirmDialog}
      <div className="flex items-center gap-1">
        {caps.edit && edited && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Reset edits"
                onClick={() => void resetEdits()}
              >
                <Palette
                  aria-hidden
                  className={dirty ? "text-amber-500" : "text-primary"}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {dirty ? "Reset edits (unsaved changes)" : "Reset edits"}
            </TooltipContent>
          </Tooltip>
        )}
        {caps.favorite && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={
                  photo.isFavorite ? "Remove from favorites" : "Add to favorites"
                }
                onClick={() => void toggleFavorite()}
              >
                <Heart
                  fill={photo.isFavorite ? "currentColor" : "none"}
                  aria-hidden
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {photo.isFavorite ? "Remove from favorites" : "Favorite"}
              <Kbd>F</Kbd>
            </TooltipContent>
          </Tooltip>
        )}

        {caps.download && (
          hasEdits(photo.edits) ? (
            <Tooltip>
            <DropdownMenu>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Download"
                  >
                    <Download aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    downloadFromUrl(
                      catalogApiUrl(slug, `/photos/${photo.id}/edited?download=1`),
                    )
                  }
                >
                  Download edited
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    downloadFromUrl(
                      catalogApiUrl(slug, `/photos/${photo.id}/original?download=1`),
                    )
                  }
                >
                  Download original
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>Download</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Download"
                >
                  <a href={catalogApiUrl(slug, `/photos/${photo.id}/original?download=1`)}>
                    <Download aria-hidden />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
          )
        )}

        {caps.trash && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Move to Trash"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => void trash()}
              >
                <Trash2 aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Move to Trash
              <Kbd>⌫</Kbd>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </>
  );
}
