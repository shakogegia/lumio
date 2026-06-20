"use client";

import { Download, FolderPlus, Palette, Trash2 } from "lucide-react";
import { COLOR_LABELS } from "@lumio/shared";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePhotoActionsContext } from "@/components/photo-actions/photo-actions-context";

/**
 * Wraps a grid tile as a right-click context-menu trigger: Download, Add to
 * album, Color label (submenu), Delete. `targetIds` is already resolved
 * selection-aware by the caller. Renders the tile unwrapped when no actions
 * provider is present (e.g. the Trash grid), so the menu is a clean no-op there.
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {count > 1 && (
          <>
            <ContextMenuLabel>{count} photos</ContextMenuLabel>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => void actions.download(targetIds)}>
          <Download aria-hidden />
          Download
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.addToAlbum(targetIds)}>
          <FolderPlus aria-hidden />
          Add to album
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Palette aria-hidden />
            Color label
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            {COLOR_LABELS.map((c) => (
              <ContextMenuItem
                key={c.slug}
                onSelect={() => void actions.applyLabel(targetIds, c.slug)}
              >
                <span
                  className="size-4 rounded-full ring-1 ring-foreground/10"
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
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => void actions.trash(targetIds, { onSuccess: onTrashed })}
        >
          <Trash2 aria-hidden />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
