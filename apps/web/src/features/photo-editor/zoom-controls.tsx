"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MAX_ZOOM } from "./zoom-math";
import { ZoomSlider } from "./zoom-slider";

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
  const valueLabel = atFit ? "Fit" : `${Math.round(zoom)}%`;

  // Reveal the readout above the slider thumb only while the user is actively
  // changing zoom: a drag streams onValueChange and keeps it lit; a +/- step
  // flashes it once. Each change resets the hide timer, so it lingers a beat
  // then fades.
  const [showValue, setShowValue] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashValue = useCallback(() => {
    setShowValue(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowValue(false), 900);
  }, []);
  useEffect(() => {
    const timer = hideTimer;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const stepOut = () => {
    onStepOut();
    flashValue();
  };
  const stepIn = () => {
    onStepIn();
    flashValue();
  };

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Zoom out"
            disabled={!canStepOut}
            onClick={stepOut}
          >
            <Minus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>
      <ZoomSlider
        className="hidden w-20 sm:flex"
        min={min}
        max={MAX_ZOOM}
        step={1}
        value={zoom}
        onValueChange={(v) => {
          onZoom(v);
          flashValue();
        }}
        valueLabel={valueLabel}
        showValue={showValue}
        aria-label="Zoom"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Zoom in"
            disabled={!canStepIn}
            onClick={stepIn}
          >
            <Plus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>
    </div>
  );
}
