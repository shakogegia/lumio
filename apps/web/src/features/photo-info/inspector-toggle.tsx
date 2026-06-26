"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Selection-toolbar button that opens/closes the detail inspector. */
export function InspectorToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={open ? "secondary" : "outline"}
          size="icon-sm"
          aria-pressed={open}
          onClick={onToggle}
          aria-label="Toggle info panel"
        >
          <Info aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Info
        <Kbd>i</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
