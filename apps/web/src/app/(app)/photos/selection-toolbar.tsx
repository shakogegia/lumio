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
    <div className="mb-6 flex items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold">
        {count > 0 ? `${count} selected` : title}
      </h1>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {actions}
      </div>
    </div>
  );
}
