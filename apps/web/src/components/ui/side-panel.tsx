import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * A right-docked, non-modal panel: fixed to the viewport's right edge, full
 * height, its own vertical scroll. Reusable chrome for any inspector — it knows
 * nothing about photos. The host reserves space for it (e.g. `pr-80` on the
 * content) so the panel sits beside the content rather than over it. Opaque +
 * `z-30` so it cleanly covers a sticky toolbar's full-bleed band underneath.
 */
export function SidePanel({
  title,
  onClose,
  className,
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      className={cn(
        "fixed top-0 right-0 z-30 flex h-dvh w-80 flex-col border-l bg-background",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">{title}</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
          <X aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}
