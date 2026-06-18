"use client";

import { Button } from "@/components/ui/button";

export function SelectionToolbar({
  title,
  count,
  onCancel,
  actions,
}: {
  /** Shown on the left when nothing is selected yet. */
  title: string;
  count: number;
  onCancel: () => void;
  /** Page-specific action buttons (e.g. Add to album, Remove from album). */
  actions: React.ReactNode;
}) {
  return (
    // Sticky so the actions stay reachable while scrolling a long grid. The
    // -mt-6/pt-6 reclaim the page's `p-6` top padding so the bar sticks flush to
    // the top (bg-background occludes photos scrolling under it) while keeping
    // the title position and overall height identical to the normal header.
    <div className="sticky top-0 z-20 -mt-6 mb-6 flex items-center justify-between gap-4 bg-background pt-6">
      <h1 className="text-2xl font-semibold">
        {count > 0 ? `${count} selected` : title}
      </h1>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {actions}
      </div>
    </div>
  );
}
