"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeaderBar } from "@/components/header-bar";

export function SelectionToolbar({
  title,
  count,
  totalLabel,
  onCancel,
  actions,
}: {
  /** The page title, kept visible while selecting. */
  title: React.ReactNode;
  count: number;
  /** Formatted total (e.g. "1,234 photos") shown before the selected tally. */
  totalLabel?: string;
  onCancel: () => void;
  /** Page-specific action buttons (e.g. Add to album, Remove from album). */
  actions: React.ReactNode;
}) {
  return (
    <HeaderBar
      title={title}
      subtitle={totalLabel ? `${totalLabel} · ${count} selected` : `${count} selected`}
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
