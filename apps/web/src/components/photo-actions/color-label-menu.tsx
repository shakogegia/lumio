"use client";

import { Palette } from "lucide-react";
import { COLOR_LABELS, type ColorLabel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={disabled}
          aria-label="Color label"
          title="Color label"
        >
          <Palette aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
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
  );
}
