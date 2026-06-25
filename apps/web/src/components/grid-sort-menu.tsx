"use client";

import { ArrowDownUp } from "lucide-react";
import { PHOTO_SORTS, type PhotoSort } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Header control to pick the photo sort. Mirrors GridViewMenu: an icon-button
 * trigger opening a radio group, grouped into Date taken / Date imported / File created with
 * newest- and oldest-first under each. The active value is checked.
 */
export function GridSortMenu({
  sort,
  onSortChange,
}: {
  sort: PhotoSort;
  onSortChange: (sort: PhotoSort) => void;
}) {
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Sort">
              <ArrowDownUp />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => {
              if ((PHOTO_SORTS as readonly string[]).includes(value)) {
                onSortChange(value as PhotoSort);
              }
            }}
          >
            <DropdownMenuLabel>Date taken</DropdownMenuLabel>
            <DropdownMenuRadioItem value="taken-desc">Newest first</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="taken-asc">Oldest first</DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Date imported</DropdownMenuLabel>
            <DropdownMenuRadioItem value="imported-desc">Newest first</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="imported-asc">Oldest first</DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>File created</DropdownMenuLabel>
            <DropdownMenuRadioItem value="file-created-desc">Newest first</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="file-created-asc">Oldest first</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>Sort</TooltipContent>
    </Tooltip>
  );
}
