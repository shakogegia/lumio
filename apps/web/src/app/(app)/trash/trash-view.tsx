"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { JobType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { useAsyncJob } from "@/lib/use-async-job";
import { useGridSelection } from "@/lib/use-grid-selection";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { HeaderBar } from "@/components/header-bar";
import { useConfirm, type ConfirmOptions } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

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
  const sel = useGridSelection();
  const { confirm, confirmDialog } = useConfirm();
  const gridRef = useRef<PhotoGridHandle>(null);
  // Bumped to remount the grid after "Empty trash" (which clears even unloaded
  // pages); selective actions drop tiles in place via the grid handle instead.
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState(false);
  // "Empty trash" is an async job (worker-driven); restore/purge stay synchronous.
  const emptyTrash = useAsyncJob(JobType.empty_trash, "/api/trash/empty", {
    onComplete: () => {
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

  return (
    <>
      {confirmDialog}
      <HeaderBar
        title={count > 0 ? `${count} selected` : "Trash"}
        actions={
          <>
            {count > 0 && (
              <>
                <Button
                  size="sm"
                  disabled={pending || emptying}
                  onClick={() =>
                    void act("/api/trash/restore", { ids }, null, "Failed to restore photos.", false)
                  }
                >
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending || emptying}
                  onClick={() =>
                    void act(
                      "/api/trash/purge",
                      { ids },
                      {
                        title: `Permanently delete ${label}?`,
                        description: "This can't be undone — the photos and their files are removed for good.",
                        confirmLabel: "Delete permanently",
                        destructive: true,
                      },
                      "Failed to delete photos.",
                      false,
                    )
                  }
                >
                  Delete permanently
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

      <PhotoGrid
        key={reloadKey}
        apiRef={gridRef}
        endpoint="/api/trash"
        selectMode
        selectedIds={sel.selected}
        onSelectionChange={sel.setSelected}
        empty={TRASH_EMPTY}
      />
    </>
  );
}
