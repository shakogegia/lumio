"use client";

import { Palette } from "lucide-react";
import { COLOR_LABELS, type ColorLabel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Toolbar dropdown of the pastel color-label swatches (plus "None" to clear).
 * Pure UI: it reports the picked label (or `null`) via `onPick`; the parent owns
 * applying it to the current selection.
 */
export function ColorLabelMenu({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (label: ColorLabel | null) => void;
}) {
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={disabled}
              aria-label="Color label"
            >
              <Palette aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Color label</DropdownMenuLabel>
          {COLOR_LABELS.map((c) => (
            <DropdownMenuItem key={c.slug} onSelect={() => onPick(c.slug)}>
              <span
                className="size-4 rounded-full ring-1 ring-foreground/10"
                style={{ backgroundColor: c.hex }}
                aria-hidden
              />
              {c.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onPick(null)}>None</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>Color label</TooltipContent>
    </Tooltip>
  );
}
