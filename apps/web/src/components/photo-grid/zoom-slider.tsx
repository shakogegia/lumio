"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Compact single-thumb zoom slider whose current value floats as a tiny label
 * just above the thumb while `showValue` is set — during a drag (the parent
 * keeps it lit as values stream in) or for a beat after a +/- step. Copied from
 * ui/slider rather than extending it: the shared slider has no per-thumb label
 * slot, and ui/* is off-limits for edits.
 */
export function ZoomSlider({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  onValueCommit,
  valueLabel,
  showValue,
  className,
  ...props
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  onValueCommit?: () => void;
  /** Formatted current value shown above the thumb, e.g. "Fit" or "150%". */
  valueLabel: string;
  /** Whether the floating label is visible. */
  showValue: boolean;
  className?: string;
} & Omit<
  React.ComponentProps<typeof SliderPrimitive.Root>,
  "value" | "min" | "max" | "step" | "onValueChange" | "onValueCommit"
>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(v[0])}
      onValueCommit={onValueCommit}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden"
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-[8px] leading-none font-semibold tabular-nums whitespace-nowrap text-muted-foreground transition-opacity duration-150",
            showValue ? "opacity-100" : "opacity-0",
          )}
        >
          {valueLabel}
        </span>
      </SliderPrimitive.Thumb>
    </SliderPrimitive.Root>
  );
}
