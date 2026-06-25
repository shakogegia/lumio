"use client";

import { X } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { ZoomControls } from "@/features/photo-editor";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { LightboxActions } from "./lightbox-actions";

/**
 * Header bar above the photo: zoom controls on the left, filename + resolution
 * centered, and the action icon buttons + a close button on the right.
 */
export function LightboxHeader({
  photo,
  onTrashed,
  onClose,
  zoom,
  min,
  onZoom,
  onStepIn,
  onStepOut,
  canStepIn,
  canStepOut,
  showZoom = true,
}: {
  photo: PhotoDTO;
  onTrashed: () => void;
  /** Close the lightbox (guarded for unsaved edits by the caller). */
  onClose: () => void;
  zoom: number;
  min: number;
  onZoom: (zoom: number) => void;
  onStepIn: () => void;
  onStepOut: () => void;
  canStepIn: boolean;
  canStepOut: boolean;
  /** Hide the zoom controls (e.g. in crop mode, where zoom is disabled). */
  showZoom?: boolean;
}) {
  const filename = photo.path.split("/").pop() || photo.path;
  return (
    <header className="flex shrink-0 items-center gap-3 border-b bg-background px-3 py-2">
      <div className="flex flex-1 justify-start">
        {showZoom && (
          <ZoomControls
            zoom={zoom}
            min={min}
            onZoom={onZoom}
            onStepIn={onStepIn}
            onStepOut={onStepOut}
            canStepIn={canStepIn}
            canStepOut={canStepOut}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col items-center text-center">
        <h2 className="max-w-full truncate text-sm font-medium break-all">
          {filename}
        </h2>
        <p className="text-xs text-muted-foreground">
          {photo.width}×{photo.height}
        </p>
      </div>
      <div className="flex flex-1 items-center justify-end gap-1">
        <LightboxActions photo={photo} onTrashed={onTrashed} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Close
            <Kbd>Esc</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
