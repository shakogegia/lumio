"use client";

import { Clock, Copy, Link2, Lock, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import type { ShareLinkSummaryDTO } from "@lumio/shared";
import { countLabel } from "@/lib/count-label";
import { SelectionRing } from "@/features/photo-grid";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/**
 * One shared link in the listing grid. Mirrors AlbumCard: plain left click
 * selects only it; ⌘/Ctrl click toggles; shift click extends a range; double
 * click opens the public gallery in a new tab; middle/⌘ click opens the native
 * link (new tab). Right click opens a context menu (open / copy / revoke); copy
 * and revoke act on the clicked row (the grid resolves selection-aware revoke).
 */
export function SharedLinkCard({
  row,
  isSelected,
  onSelect,
  onOpen,
  onCopy,
  onRevoke,
}: {
  row: ShareLinkSummaryDTO;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onCopy: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  const { slug } = useCatalog();
  const cover = (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm bg-muted">
      {row.coverPhotoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={catalogApiUrl(slug, `/photos/${row.coverPhotoId}/thumbnail`)}
          alt={row.title ?? "Shared link"}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <Link2 className="size-8 text-muted-foreground" />
      )}
    </div>
  );

  const meta = (
    <div className="mt-2.5">
      <p className="truncate text-sm font-semibold">{row.title ?? "Untitled link"}</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span>{countLabel(row.photoCount, "photo", "photos")}</span>
        {row.hasPassword && (
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3" aria-hidden /> Password
          </span>
        )}
        {row.expiresAt && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            {row.isExpired
              ? "Expired"
              : `Expires ${new Date(row.expiresAt).toLocaleDateString()}`}
          </span>
        )}
      </p>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          data-card-id={row.id}
          onClick={(e) => {
            // Middle/aux click opens the native link (new tab); every left click
            // selects: plain = only this, ⌘/Ctrl = toggle, shift = range.
            if (e.button !== 0) return;
            e.preventDefault();
            onSelect(row.id, e);
          }}
          onDoubleClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpen(row.id);
          }}
          className="group block select-none"
        >
          <div className="relative rounded-sm">
            {cover}
            {isSelected && <SelectionRing className="rounded-sm" />}
          </div>
          {meta}
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onOpen(row.id)}>
          <SquareArrowOutUpRight aria-hidden />
          Open
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onCopy(row.id)}>
          <Copy aria-hidden />
          Copy link
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onRevoke(row.id)}>
          <Trash2 aria-hidden />
          Revoke
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
