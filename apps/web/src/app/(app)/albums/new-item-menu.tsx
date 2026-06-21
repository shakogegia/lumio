"use client";

import { useState } from "react";
import { ChevronDown, FolderPlus, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewFolderDialog } from "./new-folder-dialog";
import { NewAlbumDialog } from "./new-album-dialog";

/**
 * A single "New" toolbar button whose dropdown creates a folder or an album at the
 * current level. Both dialogs are rendered controlled (no own trigger) and opened
 * from the menu items.
 */
export function NewItemMenu({ parentId }: { parentId: string | null }) {
  const [folderOpen, setFolderOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm">
            New
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setFolderOpen(true)}>
            <FolderPlus aria-hidden />
            New folder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAlbumOpen(true)}>
            <Images aria-hidden />
            New album
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewFolderDialog parentId={parentId} open={folderOpen} onOpenChange={setFolderOpen} />
      <NewAlbumDialog folderId={parentId} open={albumOpen} onOpenChange={setAlbumOpen} />
    </>
  );
}
