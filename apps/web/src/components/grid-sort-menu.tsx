"use client";

import { Fragment } from "react";
import { ArrowDownUp } from "lucide-react";
import { isPhotoSort, metadataSort, type PhotoSort } from "@lumio/shared";
import type { DateSortField } from "@/lib/grid-sort";
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
 * trigger opening a radio group, grouped into Date taken / Date imported / File
 * created, plus one group per enabled custom Date field, each with newest- and
 * oldest-first. The active value is checked.
 */
export function GridSortMenu({
  sort,
  onSortChange,
  dateFields = [],
}: {
  sort: PhotoSort;
  onSortChange: (sort: PhotoSort) => void;
  dateFields?: DateSortField[];
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
              if (isPhotoSort(value)) onSortChange(value);
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
            {dateFields.map((f) => (
              <Fragment key={f.id}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{`Metadata · ${f.label}`}</DropdownMenuLabel>
                <DropdownMenuRadioItem value={metadataSort(f.id, "desc")}>Newest first</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value={metadataSort(f.id, "asc")}>Oldest first</DropdownMenuRadioItem>
              </Fragment>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>Sort</TooltipContent>
    </Tooltip>
  );
}
