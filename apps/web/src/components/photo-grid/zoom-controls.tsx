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
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border bg-background/70 px-2 py-1 backdrop-blur">
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
