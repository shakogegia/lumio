"use client";

import { Grid2x2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { COLUMNS_MAX, COLUMNS_MIN } from "@/lib/grid-layout";

// One tick mark per selectable column count.
const STEP_COUNT = COLUMNS_MAX - COLUMNS_MIN + 1;

/**
 * Header control to adjust grid density. An icon-button trigger opens a Popover
 * with a stepped slider (Popover, not DropdownMenu, so the slider's arrow-key
 * handling isn't captured by menu roving focus). The slider runs from small
 * tiles (left, many columns) to large tiles (right, few columns); since more
 * columns means smaller tiles, the slider value is the inverse of the column
 * count.
 */
export function GridSizeMenu({
  columns,
  onColumnsChange,
}: {
  columns: number;
  onColumnsChange: (columns: number) => void;
}) {
  const sliderValue = COLUMNS_MIN + COLUMNS_MAX - columns;
  return (
    <Tooltip>
      <Popover>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Grid size">
              <Grid2x2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent align="end" className="w-56">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Grid size</p>
          <Slider
            value={[sliderValue]}
            min={COLUMNS_MIN}
            max={COLUMNS_MAX}
            step={1}
            onValueChange={(values) => {
              const v = values[0];
              if (typeof v === "number") onColumnsChange(COLUMNS_MIN + COLUMNS_MAX - v);
            }}
            aria-label="Grid size"
          />
          {/* Ticks are inset by half the thumb width (size-4 → px-2) so each line
              sits under the position where the thumb actually stops. */}
          <div className="mt-1.5 flex justify-between px-2" aria-hidden="true">
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <span key={i} className="h-1.5 w-px bg-border" />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <TooltipContent>Grid size</TooltipContent>
    </Tooltip>
  );
}
