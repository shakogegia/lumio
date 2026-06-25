"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShareLinkDialog } from "./share-link-dialog";

export function ShareButton({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={ids.length === 0}
            onClick={() => setOpen(true)}
            aria-label="Share"
          >
            <Share2 aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Share</TooltipContent>
      </Tooltip>
      <ShareLinkDialog ids={ids} open={open} onOpenChange={setOpen} />
    </>
  );
}
