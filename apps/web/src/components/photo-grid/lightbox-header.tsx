"use client";

import type { PhotoDTO } from "@lumio/shared";
import { ZoomControls } from "./zoom-controls";
import { LightboxActions } from "./lightbox-actions";

/**
 * Header bar above the photo: zoom controls on the left, filename + resolution
 * centered, and the favorite/download/trash icon buttons on the right.
 */
export function LightboxHeader({
  photo,
  onTrashed,
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
      <div className="flex flex-1 justify-end">
        <LightboxActions photo={photo} onTrashed={onTrashed} />
      </div>
    </header>
  );
}
