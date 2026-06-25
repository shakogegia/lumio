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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Toolbar download control. With no edited photos in the selection it's a plain
 * icon button that downloads the originals; when any selected photo is edited it
 * becomes a dropdown offering edited vs original (the server bakes edits per
 * photo for the chosen variant). Mirrors the grid right-click menu's choice and
 * the lightbox's download dropdown. `onDownload()` with no variant defaults to
 * originals — same as a multi-photo zip with no edits.
 */
export function DownloadMenu({
  count,
  anyEdited,
  disabled,
  pending,
  onDownload,
}: {
  count: number;
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={disabled}
            onClick={() => onDownload()}
            aria-label="Download"
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download</TooltipContent>
      </Tooltip>
    );
  }

  // A single photo reads "Download edited"; many keep the count, e.g.
  // "Download 3 photos edited". No "1 photo" — the count only earns its keep
  // once there's more than one.
  const prefix = count === 1 ? "" : `${count} photos `;
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={disabled}
              aria-label="Download"
            >
              {icon}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onDownload("edited")}>
            Download {prefix}edited
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDownload("original")}>
            Download {prefix}original
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>Download</TooltipContent>
    </Tooltip>
  );
}
