"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ShareLinkSummaryDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HeaderBar } from "@/components/header-bar";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { SelectionToolbar } from "@/components/photo-actions/selection-toolbar";
import { useGridSelection } from "@/lib/hooks/use-grid-selection";
import { useGridSelectionNav } from "@/lib/hooks/use-grid-selection-nav";
import { useAlbumColumns } from "@/lib/hooks/use-album-columns";
import { ALBUM_DEFAULT_COLUMNS } from "@/lib/grid-layout";
import { countLabel } from "@/lib/count-label";
import { useConfirm } from "@/components/confirm-dialog";
import { catalogApiUrl } from "@/lib/catalog-api";
import { SharedLinkCard } from "./shared-link-card";

export function SharedLinksGrid({ slug, rows }: { slug: string; rows: ShareLinkSummaryDTO[] }) {
  const router = useRouter();
  const sel = useGridSelection();
  const { columns, setColumns } = useAlbumColumns();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);

  // Reading order — the flat list the selection reducer and arrow-key navigation
  // index against (mirrors FolderBrowser's orderedIds).
  const orderedIds = rows.map((r) => r.id);
  const indexOf = new Map(orderedIds.map((id, i) => [id, i]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const gridRef = useRef<HTMLDivElement>(null);

  function openLink(id: string) {
    const row = byId.get(id);
    if (row) window.open(row.url, "_blank", "noopener");
  }

  const { handleItemClick } = useGridSelectionNav({
    count: orderedIds.length,
    columns,
    idAt: (i) => orderedIds[i],
    getClickIds: () => orderedIds,
    selectedIds: sel.selected,
    onSelectionChange: sel.setSelected,
    scrollToIndex: (i) => {
      const id = orderedIds[i];
      if (id) gridRef.current?.querySelector(`[data-card-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
    },
  });

  function onCardSelect(id: string, e: React.MouseEvent) {
    const i = indexOf.get(id);
    if (i !== undefined) handleItemClick(i, e);
  }

  async function copyLink(id: string) {
    const row = byId.get(id);
    if (!row) return;
    try {
      await navigator.clipboard.writeText(row.url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  /** Selection-aware: revoke the whole selection when the item is selected, else just it. */
  async function revoke(ids: string[]) {
    if (busy || ids.length === 0) return;
    const count = ids.length;
    const ok = await confirm({
      title: count > 1 ? `Revoke ${count} links?` : "Revoke link?",
      description: "The link(s) will stop working immediately. This can't be undone.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(
        ids.map((id) => fetch(`${catalogApiUrl(slug, "/share-links")}/${id}`, { method: "DELETE" })),
      );
      sel.clear();
      router.refresh();
    } catch {
      toast.error("Failed to revoke.");
    } finally {
      setBusy(false);
    }
  }

  /** From a card: act on the whole selection when the card is selected, else just it. */
  function revokeFromCard(id: string) {
    void revoke(sel.selected.has(id) ? [...sel.selected] : [id]);
  }

  const selectedIds = [...sel.selected];

  return (
    <>
      {confirmDialog}

      {sel.count > 0 ? (
        <SelectionToolbar
          title="Select links"
          count={sel.count}
          onCancel={sel.clear}
          actions={
            <>
              {sel.count === 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Copy link"
                      onClick={() => void copyLink(selectedIds[0])}
                    >
                      <Copy aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy link</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    disabled={busy}
                    onClick={() => void revoke(selectedIds)}
                    aria-label="Revoke"
                  >
                    {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Revoke</TooltipContent>
              </Tooltip>
            </>
          }
        />
      ) : (
        <HeaderBar
          title="Shared links"
          subtitle={countLabel(rows.length, "link", "links")}
          actions={<GridSizeMenu columns={columns} onColumnsChange={setColumns} />}
        />
      )}

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2 />
            </EmptyMedia>
            <EmptyTitle>No shared links yet</EmptyTitle>
            <EmptyDescription>Select photos and choose Share to create one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          ref={gridRef}
          className="grid gap-x-5 gap-y-7"
          style={{ gridTemplateColumns: `repeat(var(--album-columns, ${ALBUM_DEFAULT_COLUMNS}), minmax(0, 1fr))` }}
        >
          {rows.map((row) => (
            <SharedLinkCard
              key={row.id}
              row={row}
              isSelected={sel.selected.has(row.id)}
              onSelect={onCardSelect}
              onOpen={openLink}
              onCopy={(id) => void copyLink(id)}
              onRevoke={revokeFromCard}
            />
          ))}
        </div>
      )}
    </>
  );
}
