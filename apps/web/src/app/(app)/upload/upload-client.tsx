"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download } from "lucide-react";
import type { ColorLabel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { HeaderBar } from "@/components/header-bar";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridView } from "@/lib/use-grid-view";
import { downloadSelection } from "@/lib/download-client";
import { partitionSupported } from "@/lib/upload-collect";
import {
  selectableIds,
  summarizeRows,
  toggleId,
  type Row,
  type RowStatus,
} from "@/lib/upload-rows";
import { SelectionToolbar } from "../photos/selection-toolbar";
import { UploadDropzone } from "./upload-dropzone";
import { UploadCommandBar } from "./upload-command-bar";
import { UploadTile } from "./upload-tile";

const CONCURRENCY = 3;
let nextRowId = 1;

type UploadResponse = { status: RowStatus | "unsupported"; id?: string; message?: string };

export function UploadClient() {
  const router = useRouter();
  const sel = useGridSelection();
  const { columns, setColumns } = useGridColumns();
  const { mode, setMode } = useGridView();
  const { confirm, confirmDialog } = useConfirm();

  const [rows, setRows] = useState<Row[]>([]);
  const [unsupportedCount, setUnsupportedCount] = useState(0);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const update = useCallback((id: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, rowId: number) => {
      update(rowId, { status: "uploading", message: undefined });
      const body = new FormData();
      body.set("file", file);
      body.set("lastModified", String(file.lastModified));
      try {
        const res = await fetch("/api/uploads", { method: "POST", body });
        const data: UploadResponse = await res.json();
        if (data.status === "unsupported") {
          // Pre-filtered client-side; a late unsupported is treated as a failure.
          update(rowId, { status: "error", message: "Unsupported format" });
          return;
        }
        update(rowId, { status: data.status, message: data.message, photoId: data.id });
      } catch (err) {
        update(rowId, { status: "error", message: (err as Error).message });
      }
    },
    [update],
  );

  // Bounded-concurrency worker pool shared by initial uploads and retries.
  const runPool = useCallback(
    async (queued: Array<{ file: File; rowId: number }>) => {
      if (queued.length === 0) return;
      let cursor = 0;
      async function worker() {
        while (cursor < queued.length) {
          const item = queued[cursor++];
          if (item) await uploadOne(item.file, item.rowId);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
      router.refresh();
    },
    [router, uploadOne],
  );

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const { supported, skipped } = partitionSupported(incoming);
      if (skipped > 0) setUnsupportedCount((n) => n + skipped);
      if (supported.length === 0) return;
      const queued = supported.map((file) => ({ file, rowId: nextRowId++ }));
      setRows((prev) => [
        ...queued.map(({ file, rowId }) => ({
          id: rowId,
          file,
          name: file.name,
          status: "queued" as const,
        })),
        ...prev,
      ]);
      await runPool(queued);
    },
    [runPool],
  );

  const retryRows = useCallback(
    (targets: Row[]) => {
      void runPool(targets.map((r) => ({ file: r.file, rowId: r.id })));
    },
    [runPool],
  );

  // Latest rows, readable from stable callbacks without making them depend on
  // (and thus be recreated by) every rows change — which would defeat the
  // memoized tiles below. A retry's file never changes after a row is created,
  // so a one-render-stale ref is harmless here.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Stable per-tile callbacks (identity preserved across renders) so React.memo
  // on UploadTile actually skips unchanged tiles when one selection toggles.
  // `setSelected` is a useState setter, so its identity is stable.
  const { setSelected } = sel;
  const toggleSelect = useCallback(
    (photoId: string) => setSelected((prev) => toggleId(prev, photoId)),
    [setSelected],
  );

  const retryRow = useCallback(
    (rowId: number) => {
      const row = rowsRef.current.find((r) => r.id === rowId);
      if (row) void runPool([{ file: row.file, rowId }]);
    },
    [runPool],
  );

  const applyLabel = useCallback(
    async (label: ColorLabel | null) => {
      if (labelPending || sel.selected.size === 0) return;
      setLabelPending(true);
      try {
        const res = await fetch("/api/photos/color-label", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: [...sel.selected], label }),
        });
        if (!res.ok) throw new Error("label failed");
        toast.success("Label applied.");
        sel.clear();
      } catch {
        toast.error("Failed to apply label.");
      } finally {
        setLabelPending(false);
      }
    },
    [labelPending, sel],
  );

  const handleDownload = useCallback(async () => {
    if (downloading || sel.selected.size === 0) return;
    setDownloading(true);
    try {
      await downloadSelection([...sel.selected]);
      sel.clear();
    } catch {
      toast.error("Failed to download photos.");
    } finally {
      setDownloading(false);
    }
  }, [downloading, sel]);

  const handleDelete = useCallback(async () => {
    const selectedIds = sel.selected;
    if (selectedIds.size === 0 || deleting) return;
    const label = `${selectedIds.size} ${selectedIds.size === 1 ? "photo" : "photos"}`;
    const ok = await confirm({
      title: `Move ${label} to Trash?`,
      description: "They'll be moved to Trash. You can restore them later.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      if (!res.ok) throw new Error("trash failed");
      setRows((prev) => prev.filter((r) => !(r.photoId && selectedIds.has(r.photoId))));
      sel.cancel();
      router.refresh();
    } catch {
      toast.error("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }, [sel, deleting, confirm, router]);

  const summary = summarizeRows(rows);
  const ids = selectableIds(rows);
  const hasRows = rows.length > 0;

  return (
    <>
      {confirmDialog}

      {sel.selectMode ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <>
              <ColorLabelMenu
                disabled={sel.count === 0 || labelPending}
                onPick={(l) => void applyLabel(l)}
              />
              <Button size="sm" disabled={sel.count === 0} onClick={() => setAlbumOpen(true)}>
                Add to album
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={sel.count === 0 || downloading}
                onClick={() => void handleDownload()}
              >
                <Download aria-hidden />
                {downloading ? "Preparing…" : "Download"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={sel.count === 0 || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title="Upload"
          actions={
            hasRows ? (
              <>
                <GridViewMenu mode={mode} onModeChange={setMode} />
                <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ids.length === 0}
                  onClick={sel.enter}
                >
                  Select
                </Button>
              </>
            ) : null
          }
        />
      )}

      <div className="space-y-6 pt-2">
        <UploadDropzone variant={hasRows ? "slim" : "hero"} onFiles={(f) => void addFiles(f)} />

        {hasRows ? (
          <UploadCommandBar
            summary={summary}
            unsupportedCount={unsupportedCount}
            onRetryFailed={() => retryRows(rows.filter((r) => r.status === "error"))}
            onViewLibrary={() => router.push("/photos")}
          />
        ) : unsupportedCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            Skipped {unsupportedCount} unsupported file{unsupportedCount === 1 ? "" : "s"}.
          </p>
        ) : null}

        {hasRows ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {rows.map((row) => (
              <UploadTile
                key={row.id}
                id={row.id}
                photoId={row.photoId}
                name={row.name}
                status={row.status}
                message={row.message}
                mode={mode}
                selectMode={sel.selectMode}
                selected={Boolean(row.photoId && sel.selected.has(row.photoId))}
                onToggleSelect={toggleSelect}
                onRetry={retryRow}
              />
            ))}
          </div>
        ) : null}
      </div>

      <AddToAlbumDialog
        open={albumOpen}
        onOpenChange={setAlbumOpen}
        photoIds={[...sel.selected]}
        onAdded={() => {
          setAlbumOpen(false);
          sel.clear();
        }}
      />
    </>
  );
}
