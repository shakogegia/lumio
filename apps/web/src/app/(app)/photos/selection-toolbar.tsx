"use client";

import { Button } from "@/components/ui/button";
import { HeaderBar } from "./header-bar";

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
    <HeaderBar>
      <h1 className="text-2xl font-semibold">
        {count > 0 ? `${count} selected` : title}
      </h1>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {actions}
      </div>
    </HeaderBar>
  );
}
