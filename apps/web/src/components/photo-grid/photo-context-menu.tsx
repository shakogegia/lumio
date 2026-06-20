"use client";

import { Download, FolderPlus, Palette, Trash2 } from "lucide-react";
import { COLOR_LABELS } from "@lumio/shared";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePhotoActionsContext } from "@/components/photo-actions/photo-actions-context";
import { AlbumPickerItems } from "@/components/photo-actions/album-picker-items";

/**
 * Wraps a grid tile as a right-click context-menu trigger: a group of actions
 * (Download, Add to album → albums submenu, Color label → swatches submenu),
 * then a separator and a destructive Delete. The acted-on count is carried in
 * each action's label. `targetIds` is already resolved selection-aware by the
 * caller. Renders the tile unwrapped when no actions provider is present (e.g.
 * the Trash grid), so the menu no-ops there.
 */
export function PhotoContextMenu({
  targetIds,
  onTrashed,
  children,
}: {
  targetIds: string[];
  /** Called after a successful menu-driven trash (drops ids from selection). */
  onTrashed?: () => void;
  children: React.ReactNode;
}) {
  const actions = usePhotoActionsContext();
  if (!actions) return <>{children}</>;

  const count = targetIds.length;
  // "photo" for a single target, "N photos" for many — no "1" on the singular.
  const photos = count === 1 ? "photo" : `${count} photos`;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuGroup>
          <ContextMenuItem onSelect={() => void actions.download(targetIds)}>
            <Download aria-hidden />
            Download {photos}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2.5">
              <FolderPlus aria-hidden />
              Add {photos} to album
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-56">
              <AlbumPickerItems
                Item={ContextMenuItem}
                Separator={ContextMenuSeparator}
                excludeAlbumId={actions.excludeAlbumId}
                onPick={(albumId) => void actions.addToAlbumDirect(targetIds, albumId)}
                onCreateNew={() => actions.addToAlbum(targetIds)}
              />
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2.5">
              <Palette aria-hidden />
              Color label
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-44">
              {COLOR_LABELS.map((c) => (
                <ContextMenuItem
                  key={c.slug}
                  onSelect={() => void actions.applyLabel(targetIds, c.slug)}
                >
                  <span
                    className="size-4 shrink-0 rounded-full ring-1 ring-foreground/10"
                    style={{ backgroundColor: c.hex }}
                    aria-hidden
                  />
                  {c.name}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => void actions.applyLabel(targetIds, null)}>
                None
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => void actions.trash(targetIds, { onSuccess: onTrashed })}
        >
          <Trash2 aria-hidden />
          Delete {photos}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
