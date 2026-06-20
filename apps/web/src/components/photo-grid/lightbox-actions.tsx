"use client";

import { toast } from "sonner";
import { Download, FilePenLine, Heart, Trash2 } from "lucide-react";
import { hasEdits, type PhotoDTO } from "@lumio/shared";
import { downloadFromUrl } from "@/lib/download-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/confirm-dialog";
import { usePhotoCollection } from "./photo-collection";
import { useEditSession } from "./use-edit-session";

/** Icon-button row for the lightbox header: reset edits (when edited),
 *  favorite, download, move to trash. */
export function LightboxActions({
  photo,
  onTrashed,
}: {
  photo: PhotoDTO;
  onTrashed: () => void;
}) {
  const { removePhotos, patchPhotos } = usePhotoCollection();
  const { confirm, confirmDialog } = useConfirm();
  const { dirty, reset } = useEditSession();
  // Edited = unsaved working changes, or persisted edits baked into the photo.
  const edited = dirty || hasEdits(photo.edits);

  async function trash() {
    const ok = await confirm({
      title: "Move to Trash?",
      description: "You can restore it later.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch("/api/photos/trash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [photo.id] }),
    });
    if (!res.ok) {
      toast.error("Failed to move to Trash.");
      return;
    }
    removePhotos(new Set([photo.id]));
    onTrashed();
  }

  async function toggleFavorite() {
    const next = !photo.isFavorite;
    const res = await fetch("/api/photos/favorite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds: [photo.id], isFavorite: next }),
    });
    if (!res.ok) {
      toast.error("Failed to update favorites.");
      return;
    }
    patchPhotos(new Set([photo.id]), { isFavorite: next });
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
        {edited && (
          <Button
            variant="outline"
            size="icon"
            aria-label="Reset edits"
            title={dirty ? "Reset edits (unsaved changes)" : "Reset edits"}
            onClick={() => void resetEdits()}
          >
            <FilePenLine
              aria-hidden
              className={dirty ? "text-amber-500" : "text-primary"}
            />
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label={
            photo.isFavorite ? "Remove from favorites" : "Add to favorites"
          }
          title={photo.isFavorite ? "Favorited" : "Favorite"}
          onClick={() => void toggleFavorite()}
        >
          <Heart
            fill={photo.isFavorite ? "currentColor" : "none"}
            aria-hidden
          />
        </Button>

        {hasEdits(photo.edits) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Download"
                title="Download"
              >
                <Download aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  downloadFromUrl(`/api/photos/${photo.id}/edited?download=1`)
                }
              >
                Download edited
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  downloadFromUrl(`/api/photos/${photo.id}/original?download=1`)
                }
              >
                Download original
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            asChild
            variant="outline"
            size="icon"
            aria-label="Download"
            title="Download"
          >
            <a href={`/api/photos/${photo.id}/original?download=1`}>
              <Download aria-hidden />
            </a>
          </Button>
        )}

        <Button
          variant="outline"
          size="icon"
          aria-label="Move to Trash"
          title="Move to Trash"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => void trash()}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </>
  );
}
