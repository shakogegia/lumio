"use client";

import { ImageIcon, LayoutGrid, Maximize, Minimize } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GridViewMode } from "@/lib/hooks/use-grid-view";

/**
 * Header control to pick the grid view mode. Mirrors the sidebar's theme picker:
 * an icon-button trigger opening a radio group (Fill / Fit / Card) with the
 * active mode checked.
 */
export function GridViewMenu({
  mode,
  onModeChange,
}: {
  mode: GridViewMode;
  onModeChange: (mode: GridViewMode) => void;
}) {
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Grid view">
              <LayoutGrid />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => {
              if (value === "fill" || value === "fit" || value === "card") onModeChange(value);
            }}
          >
            <DropdownMenuRadioItem value="fill">
              <Maximize aria-hidden />
              Fill
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="fit">
              <Minimize aria-hidden />
              Fit
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="card">
              <ImageIcon aria-hidden />
              Card
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>Grid view</TooltipContent>
    </Tooltip>
  );
}
