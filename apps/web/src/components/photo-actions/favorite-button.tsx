"use client";

import { Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Outline icon button for the selection toolbar that toggles favorite over the
 * current selection. The parent computes the smart-toggle target and supplies
 * `onClick`; this stays pure UI like ColorLabelMenu.
 */
export function FavoriteButton({
  disabled,
  pending,
  onClick,
}: {
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={disabled}
          onClick={onClick}
          aria-label="Favorite"
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Heart aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Favorite
        <Kbd>F</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
