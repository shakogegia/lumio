"use client";

import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlbumPickerItems } from "./album-picker-items";

/**
 * Toolbar "Add to album" control: an icon button that opens a dropdown of the
 * existing albums (quick-pick) plus "New album…". Same album list as the
 * grid's right-click menu — the parent owns what a pick / create does.
 */
export function AddToAlbumMenu({
  disabled,
  excludeAlbumId,
  onPick,
  onCreateNew,
}: {
  disabled: boolean;
  excludeAlbumId?: string;
  onPick: (albumId: string) => void;
  onCreateNew: () => void;
}) {
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={disabled}
              aria-label="Add to album"
            >
              <FolderPlus aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Add to album</DropdownMenuLabel>
          <AlbumPickerItems
            menu={{
              Item: DropdownMenuItem,
              Separator: DropdownMenuSeparator,
              Sub: DropdownMenuSub,
              SubTrigger: DropdownMenuSubTrigger,
              SubContent: DropdownMenuSubContent,
            }}
            excludeAlbumId={excludeAlbumId}
            onPick={onPick}
            onCreateNew={onCreateNew}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>Add to album</TooltipContent>
    </Tooltip>
  );
}
