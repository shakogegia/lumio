"use client";

import { memo } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { colorLabelHex, type ColorLabel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { SelectionRing } from "@/features/photo-grid";
import { cn } from "@/lib/utils";
import { formatBadge } from "@/lib/upload-preview";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import type { RowStatus } from "@/lib/upload-rows";

const STATUS_LABEL: Record<RowStatus, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  added: "Added",
  duplicate: "Already in library",
  error: "Failed",
};

/**
 * Memoized so toggling the selection of one tile doesn't re-render the rest of
 * the grid. That requires the parent to pass referentially-stable callbacks
 * (`onTileClick`/`onRetry`) — otherwise memo would never hit.
 */
export const UploadTile = memo(function UploadTile({
  id,
  index,
  photoId,
  name,
  status,
  message,
  colorLabel,
  selected,
  onTileClick,
  onRetry,
}: {
  /** Client row id (for retry). */
  id: number;
  /** Position in the row list (for shift-click range selection). */
  index: number;
  /** Real photo id; present ⇒ selectable + has a server thumbnail. */
  photoId?: string;
  name: string;
  status: RowStatus;
  message?: string;
  /** Applied color label; tints the card mat. */
  colorLabel?: ColorLabel | null;
  selected: boolean;
  onTileClick: (index: number, e: React.MouseEvent) => void;
  onRetry: (id: number) => void;
}) {
  const { slug } = useCatalog();
  // Ingested rows render the small server thumbnail; in-flight/failed rows show
  // a lightweight badge (decoding originals in-browser blows up memory). Tiles
  // are always cards; the mat is tinted with the applied color label's pastel
  // (light/dark handled by the `.label-mat` rule via `--label-tint`).
  const selectable = photoId != null;
  const interactive = selectable;
  const labelHex = colorLabelHex(colorLabel);
  const labelStyle = labelHex ? ({ "--label-tint": labelHex } as React.CSSProperties) : undefined;

  const thumb = (
    <div
      className={cn(
        "relative aspect-square overflow-hidden rounded-md border border-border bg-muted p-2",
        labelHex && "label-mat",
      )}
      style={labelStyle}
    >
      <div className="h-full w-full overflow-hidden rounded-xs">
        {photoId ? (
          // eslint-disable-next-line @next/next/no-img-element -- server thumbnail route, no next/image loader
          <img
            src={catalogApiUrl(slug, `/photos/${photoId}/thumbnail`)}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-muted to-muted-foreground/15 text-muted-foreground">
            <span className="text-base font-bold tracking-wide">{formatBadge(name)}</span>
          </div>
        )}
      </div>

      {status === "uploading" || status === "queued" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-foreground/40">
          <Loader2 className="size-5 animate-spin text-background" aria-hidden />
        </div>
      ) : null}

      {status === "added" ? (
        <span
          className="absolute right-1.5 top-1.5 size-3 rounded-full bg-green-600 ring-2 ring-background dark:bg-green-500"
          aria-hidden
        />
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
              onRetry(id);
            }}
          >
            <RotateCw className="size-3" aria-hidden /> Retry
          </Button>
        </div>
      ) : null}

      {selected && <SelectionRing className="rounded-md" />}
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      {interactive ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={(e) => onTileClick(index, e)}
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
});
