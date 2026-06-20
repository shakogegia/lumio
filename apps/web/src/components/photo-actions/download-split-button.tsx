"use client";

import { useState } from "react";
import { Download, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function DownloadSplitButton({
  onDownloadEdited,
  onDownloadOriginal,
}: {
  onDownloadEdited: () => void;
  onDownloadOriginal: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="flex w-full"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Button variant="outline" size="sm" className="flex-1 rounded-r-none" onClick={onDownloadEdited}>
        <Download aria-hidden /> Download
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="rounded-l-none border-l-0 px-2"
            aria-label="Download options"
          >
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDownloadEdited}>Download edited</DropdownMenuItem>
          <DropdownMenuItem onSelect={onDownloadOriginal}>Download original</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
