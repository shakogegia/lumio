"use client";

import { useRef, useState } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { JobType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { useAsyncJob } from "@/lib/use-async-job";
import { useGridSelection } from "@/lib/use-grid-selection";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { CollectionTotalReporter } from "@/components/photo-grid/collection-total-reporter";
import { HeaderBar } from "@/components/header-bar";
import { countLabel } from "@/lib/count-label";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm, type ConfirmOptions } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";

const TRASH_EMPTY = (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Trash2 />
      </EmptyMedia>
      <EmptyTitle>Trash is empty</EmptyTitle>
      <EmptyDescription>
        Deleted photos appear here. Restore them, or delete them permanently.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

/**
 * Trash management page. Reuses the photo grid in permanent select mode (trashed
 * photos have no detail view) plus the selection infra. Selected photos can be
 * restored or permanently deleted; "Empty trash" purges everything.
 */
export function TrashView() {
  const { slug } = useCatalog();
  const sel = useGridSelection();
  const { confirm, confirmDialog } = useConfirm();
  const gridRef = useRef<PhotoGridHandle>(null);
  // Bumped to remount the grid after "Empty trash" (which clears even unloaded
  // pages); selective actions drop tiles in place via the grid handle instead.
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  // "Empty trash" is an async job (worker-driven); restore/purge stay synchronous.
  const emptyTrash = useAsyncJob(JobType.empty_trash, catalogApiUrl(slug, "/trash/empty"), {
    onComplete: () => {
      playSound(SoundEffect.EmptyTrash);
      setReloadKey((k) => k + 1);
      sel.clear();
    },
    toasts: {
      pending: "Emptying trash…",
      success: "Trash emptied",
      error: "Failed to empty Trash.",
    },
  });
  const emptying = emptyTrash.phase === "pending" || emptyTrash.isActive;

  async function act(
    url: string,
    body: object | null,
    confirmOpts: ConfirmOptions | null,
    failMsg: string,
    remount: boolean,
    onSuccess?: () => void,
  ) {
    if (pending) return;
    if (confirmOpts && !(await confirm(confirmOpts))) return;
    const selectedIds = sel.selected;
    setPending(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error("request failed");
      if (remount) setReloadKey((k) => k + 1);
      else gridRef.current?.removePhotos(selectedIds);
      onSuccess?.();
      sel.clear();
    } catch {
      toast.error(failMsg);
    } finally {
      setPending(false);
    }
  }

  const ids = [...sel.selected];
  const count = sel.count;
  const label = `${count} ${count === 1 ? "photo" : "photos"}`;
  const totalLabel = total !== null ? countLabel(total, "photo", "photos") : undefined;
  // Show a skeleton in the subtitle slot while the count loads (keeps the line reserved).
  const countSubtitle = totalLabel ?? <Skeleton className="inline-block h-3 w-16 align-middle" />;
  const subtitle =
    count > 0 ? `${totalLabel ? `${totalLabel} · ` : ""}${count} selected` : countSubtitle;

  return (
    <>
      {confirmDialog}
      <HeaderBar
        title="Trash"
        subtitle={subtitle}
        actions={
          <>
            {count > 0 && (
              <>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={pending || emptying}
                  aria-label="Restore"
                  title="Restore"
                  onClick={() =>
                    void act(catalogApiUrl(slug, "/trash/restore"), { ids }, null, "Failed to restore photos.", false)
                  }
                >
                  <ArchiveRestore aria-hidden />
                </Button>
                <Button
                  variant="destructive"
                  size="icon-sm"
                  disabled={pending || emptying}
                  aria-label="Delete permanently"
                  title="Delete permanently"
                  onClick={() =>
                    void act(
                      catalogApiUrl(slug, "/trash/purge"),
                      { ids },
                      {
                        title: `Permanently delete ${label}?`,
                        description: "This can't be undone — the photos and their files are removed for good.",
                        confirmLabel: "Delete permanently",
                        destructive: true,
                      },
                      "Failed to delete photos.",
                      false,
                      () => playSound(SoundEffect.EmptyTrash),
                    )
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={pending || emptying}
              onClick={async () => {
                if (
                  await confirm({
                    title: "Empty Trash?",
                    description:
                      "All photos in Trash will be permanently deleted. This can't be undone.",
                    confirmLabel: "Empty trash",
                    destructive: true,
                  })
                ) {
                  void emptyTrash.run();
                }
              }}
            >
              {emptying ? "Emptying…" : "Empty trash"}
            </Button>
          </>
        }
      />

      <PhotoCollectionProvider key={reloadKey} endpoint={catalogApiUrl(slug, "/trash")} enableLightbox={false}>
        <CollectionTotalReporter onTotal={setTotal} />
        <PhotoGrid
          apiRef={gridRef}
          selectedIds={sel.selected}
          onSelectionChange={sel.setSelected}
          empty={TRASH_EMPTY}
        />
      </PhotoCollectionProvider>
    </>
  );
}
