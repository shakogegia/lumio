"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MAX_ZOOM } from "@/lib/zoom-math";

export function ZoomControls({
  zoom,
  min,
  onZoom,
  onStepIn,
  onStepOut,
  canStepIn,
  canStepOut,
}: {
  zoom: number;
  /** Slider minimum — the current fit zoom. */
  min: number;
  onZoom: (zoom: number) => void;
  onStepIn: () => void;
  onStepOut: () => void;
  canStepIn: boolean;
  canStepOut: boolean;
}) {
  // At the fit minimum we label "Fit" (it may be any sub-100% value); otherwise
  // the rounded percent, where 100% is true 1:1 original pixels.
  const atFit = zoom <= min + 0.5;
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border bg-background/70 px-2 py-1 backdrop-blur">
      <span className="w-9 shrink-0 select-none text-center text-[11px] tabular-nums text-muted-foreground">
        {atFit ? "Fit" : `${Math.round(zoom)}%`}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        aria-label="Zoom out"
        disabled={!canStepOut}
        onClick={onStepOut}
      >
        <Minus className="size-4" />
      </Button>
      <Slider
        className="w-32"
        min={min}
        max={MAX_ZOOM}
        step={1}
        value={[zoom]}
        onValueChange={(v) => onZoom(v[0])}
        aria-label="Zoom"
      />
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        aria-label="Zoom in"
        disabled={!canStepIn}
        onClick={onStepIn}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
