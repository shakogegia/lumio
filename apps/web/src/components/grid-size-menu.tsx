"use client";

import { Grid2x2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { TILE_SIZE_MAX, TILE_SIZE_MIN, TILE_SIZE_STEP } from "@/lib/grid-layout";

/**
 * Header control to adjust grid tile size. An icon-button trigger opens a
 * Popover with a stepped slider (Popover, not DropdownMenu, so the slider's
 * arrow-key handling isn't captured by menu roving focus). Larger value →
 * wider target tile → fewer, larger tiles.
 */
export function GridSizeMenu({
  size,
  onSizeChange,
}: {
  size: number;
  onSizeChange: (size: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Grid size" title="Grid size">
          <Grid2x2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <Slider
          value={[size]}
          min={TILE_SIZE_MIN}
          max={TILE_SIZE_MAX}
          step={TILE_SIZE_STEP}
          onValueChange={(values) => {
            const next = values[0];
            if (typeof next === "number") onSizeChange(next);
          }}
          aria-label="Grid tile size"
        />
        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
          <span>Smaller</span>
          <span>Larger</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
