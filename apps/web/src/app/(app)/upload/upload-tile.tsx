"use client";

import { CheckCircle2, Circle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBadge, isPreviewable } from "@/lib/upload-preview";
import type { GridViewMode } from "@/lib/use-grid-view";
import type { RowStatus } from "@/lib/upload-rows";

const STATUS_LABEL: Record<RowStatus, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  added: "Added",
  duplicate: "Already in library",
  error: "Failed",
};

export function UploadTile({
  name,
  status,
  message,
  previewUrl,
  mode,
  selectMode,
  selectable,
  selected,
  onToggleSelect,
  onRetry,
}: {
  name: string;
  status: RowStatus;
  message?: string;
  previewUrl?: string;
  mode: GridViewMode;
  selectMode: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onRetry: () => void;
}) {
  const preview = isPreviewable(name) && previewUrl;
  const fit = mode === "fit" ? "object-contain" : "object-cover";
  const interactive = selectMode && selectable;

  const thumb = (
    <div
      className={cn(
        "relative aspect-square overflow-hidden rounded-md border border-border bg-muted",
        mode === "card" && "p-2",
        selected && "ring-2 ring-inset ring-primary",
      )}
    >
      <div
        className={cn(
          "h-full w-full overflow-hidden rounded-[inherit] transition-transform",
          selected && "scale-[0.92]",
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: object URL, no remote loader
          <img src={previewUrl} alt="" className={cn("h-full w-full", fit)} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-muted to-muted-foreground/15 text-muted-foreground">
            <span className="text-base font-bold tracking-wide">{formatBadge(name)}</span>
            <span className="text-[10px] uppercase tracking-wide">preview after import</span>
          </div>
        )}
      </div>

      {status === "uploading" || status === "queued" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-foreground/40">
          <Loader2 className="size-5 animate-spin text-background" aria-hidden />
        </div>
      ) : null}

      {status === "added" ? (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-background">
          <CheckCircle2 className="size-5 text-primary" aria-hidden />
        </span>
      ) : null}

      {status === "duplicate" ? (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
          Duplicate
        </span>
      ) : null}

      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/55">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 gap-1 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
          >
            <RotateCw className="size-3" aria-hidden /> Retry
          </Button>
        </div>
      ) : null}

      {selectMode && selectable ? (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-background">
          {selected ? (
            <CheckCircle2 className="size-5 text-primary" aria-hidden />
          ) : (
            <Circle className="size-5 text-muted-foreground" aria-hidden />
          )}
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      {interactive ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onToggleSelect}
          title={message ?? STATUS_LABEL[status]}
          className="block select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {thumb}
        </button>
      ) : (
        <div title={message ?? STATUS_LABEL[status]}>{thumb}</div>
      )}
      <p
        className="truncate text-center font-mono text-[11px] text-muted-foreground"
        title={name}
      >
        {name}
      </p>
    </div>
  );
}
