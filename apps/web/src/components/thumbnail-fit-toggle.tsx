"use client";

import { Expand, Shrink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";

/**
 * Header button that toggles grid thumbnails between cover and contain. The
 * icon shows what clicking will do: in cover mode it offers Shrink ("fit whole
 * photo"); in contain mode it offers Expand ("fill tile").
 */
export function ThumbnailFitToggle({
  fit,
  onToggle,
}: {
  fit: ThumbnailFit;
  onToggle: () => void;
}) {
  const switchingToContain = fit === "cover";
  const label = switchingToContain ? "Fit whole photo" : "Fill tile";
  return (
    <Button
      variant="outline"
      size="icon-sm"
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      {switchingToContain ? <Shrink /> : <Expand />}
    </Button>
  );
}
