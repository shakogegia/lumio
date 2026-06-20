"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeaderBar } from "@/components/header-bar";

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
    <HeaderBar
      title={count > 0 ? `${count} selected` : title}
      actions={
        <>
          {actions}
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onCancel}
            aria-label="Cancel"
            title="Cancel"
          >
            <X aria-hidden />
          </Button>
        </>
      }
    />
  );
}
