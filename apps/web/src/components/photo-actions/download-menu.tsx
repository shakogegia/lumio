"use client";

import { Download, Loader2 } from "lucide-react";
import type { DownloadVariant } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Toolbar download control. With no edited photos in the selection it's a plain
 * icon button that downloads the originals; when any selected photo is edited it
 * becomes a dropdown offering edited vs original (the server bakes edits per
 * photo for the chosen variant). Mirrors the grid right-click menu's choice and
 * the lightbox's download dropdown. `onDownload()` with no variant defaults to
 * originals — same as a multi-photo zip with no edits.
 */
export function DownloadMenu({
  anyEdited,
  disabled,
  pending,
  onDownload,
}: {
  anyEdited: boolean;
  disabled: boolean;
  pending: boolean;
  onDownload: (variant?: DownloadVariant) => void;
}) {
  const icon = pending ? (
    <Loader2 className="animate-spin" aria-hidden />
  ) : (
    <Download aria-hidden />
  );

  if (!anyEdited) {
    return (
      <Button
        variant="outline"
        size="icon-sm"
        disabled={disabled}
        onClick={() => onDownload()}
        aria-label="Download"
        title="Download"
      >
        {icon}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={disabled}
          aria-label="Download"
          title="Download"
        >
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onDownload("edited")}>
          Download edited
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDownload("original")}>
          Download original
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
