"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Loader2, Trash2, X } from "lucide-react";
import type { ColorLabel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { HeaderBar } from "@/components/header-bar";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumMenu } from "@/components/photo-actions/add-to-album-menu";
import { useAddToAlbum } from "@/components/photo-actions/use-add-to-album";
import { useConfirm } from "@/components/confirm-dialog";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridColumns } from "@/lib/use-grid-columns";
import { downloadSelection } from "@/lib/download-client";
import { setPhotoColorLabel, trashPhotos } from "@/lib/photo-mutations";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { partitionSupported } from "@/lib/upload-collect";
import { albumTargetIds, summarizeRows, type Row, type RowStatus } from "@/lib/upload-rows";
import { computeSelection } from "@/lib/grid-selection";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";
import { SelectionToolbar } from "../photos/selection-toolbar";
import { UploadDropzone } from "./upload-dropzone";
import { UploadCommandBar } from "./upload-command-bar";
import { UploadTile } from "./upload-tile";

const CONCURRENCY = 3;
let nextRowId = 1;

type UploadResponse = { status: RowStatus | "unsupported"; id?: string; message?: string };

export function UploadClient({
  targetAlbum: initialTargetAlbum,
}: {
  targetAlbum?: { id: string; name: string };
}) {
  const router = useRouter();
  const { slug } = useCatalog();
  const sel = useGridSelection();
  const { columns, setColumns } = useGridColumns();
  const { confirm, confirmDialog } = useConfirm();
  const album = useAddToAlbum();

  // Seeded from the URL-derived prop, but clearable in-session. Clearing stops
  // further auto-adds and strips ?albumId from the URL — via history.replaceState
  // (no navigation) so the already-uploaded tiles below aren't lost.
  const [targetAlbum, setTargetAlbum] = useState(initialTargetAlbum);
  const clearTargetAlbum = useCallback(() => {
    setTargetAlbum(undefined);
    window.history.replaceState(null, "", catalogPath(slug, "/upload"));
  }, [slug]);

  const [rows, setRows] = useState<Row[]>([]);
  const [unsupportedCount, setUnsupportedCount] = useState(0);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const update = useCallback((id: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, rowId: number): Promise<{ status: RowStatus; photoId?: string }> => {
      update(rowId, { status: "uploading", message: undefined });
      const body = new FormData();
      body.set("file", file);
      body.set("lastModified", String(file.lastModified));
      try {
        const res = await fetch(catalogApiUrl(slug, "/uploads"), { method: "POST", body });
        const data: UploadResponse = await res.json();
        if (data.status === "unsupported") {
          // Pre-filtered client-side; a late unsupported is treated as a failure.
          update(rowId, { status: "error", message: "Unsupported format" });
          return { status: "error" };
        }
        update(rowId, { status: data.status, message: data.message, photoId: data.id });
        return { status: data.status, photoId: data.id };
      } catch (err) {
        update(rowId, { status: "error", message: (err as Error).message });
        return { status: "error" };
      }
    },
    [update, slug],
  );

  // Bounded-concurrency worker pool shared by initial uploads and retries.
  const runPool = useCallback(
    async (queued: Array<{ file: File; rowId: number }>) => {
      if (queued.length === 0) return;
      let cursor = 0;
      const results: Array<{ status: RowStatus; photoId?: string }> = [];
      async function worker() {
        while (cursor < queued.length) {
          const item = queued[cursor++];
          if (item) results.push(await uploadOne(item.file, item.rowId));
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
      // When the upload page is scoped to an album, add this batch's resolved
      // photos (newly stored or pre-existing duplicates) to it. Idempotent server
      // side. Quiet on success — the upload chime + refresh below cover the batch.
      if (targetAlbum) {
        const ids = albumTargetIds(results);
        if (ids.length > 0) {
          try {
            const res = await fetch(catalogApiUrl(slug, `/albums/${targetAlbum.id}/photos`), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ photoIds: ids }),
            });
            if (!res.ok) throw new Error("add failed");
          } catch {
            toast.error("Failed to add photos to the album.");
          }
        }
      }
      // Chime once per batch when at least one genuinely new photo landed
      // (not for all-duplicate/all-failed batches). Respects the sound setting.
      if (results.some((r) => r.status === "added")) playSound(SoundEffect.ActionComplete);
      router.refresh();
    },
    [router, targetAlbum, uploadOne, slug],
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

  // Last plain-clicked row index; the anchor for shift-click range selection.
  const anchorRef = useRef<number | null>(null);

  // Reset the anchor when the selection empties so a later shift-click ranges
  // from a fresh plain click instead of a stale index (mirrors the photo grid).
  useEffect(() => {
    if (sel.count === 0) anchorRef.current = null;
  }, [sel.count]);

  // Stable per-tile callbacks (identity preserved across renders) so React.memo
  // on UploadTile actually skips unchanged tiles when one selection toggles.
  // `setSelected` is a useState setter, so its identity is stable. Reuses the
  // shared selection reducer so plain-toggle and shift-range match /photos.
  const { setSelected } = sel;
  const handleTileClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      const anchor = anchorRef.current;
      if (!e.shiftKey) anchorRef.current = index;
      const photoIds = rowsRef.current.map((r) => r.photoId ?? "");
      // ⌘ (Mac) / Ctrl (Windows) toggles multi-select; shift extends a range.
      const modifiers = { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey };
      setSelected((prev) => computeSelection(prev, photoIds, index, modifiers, anchor));
    },
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
      const selectedIds = sel.selected;
      if (labelPending || selectedIds.size === 0) return;
      setLabelPending(true);
      try {
        await setPhotoColorLabel(slug, [...selectedIds], label);
        // Optimistically tint the affected tiles, keeping the selection intact
        // so the user can keep acting on the same photos (mirrors the library view).
        setRows((prev) =>
          prev.map((r) => (r.photoId && selectedIds.has(r.photoId) ? { ...r, colorLabel: label } : r)),
        );
        toast.success("Label applied.");
      } catch {
        toast.error("Failed to apply label.");
      } finally {
        setLabelPending(false);
      }
    },
    [labelPending, sel, slug],
  );

  const handleDownload = useCallback(async () => {
    if (downloading || sel.selected.size === 0) return;
    setDownloading(true);
    try {
      await downloadSelection(slug, [...sel.selected]);
      sel.clear();
    } catch {
      toast.error("Failed to download photos.");
    } finally {
      setDownloading(false);
    }
  }, [downloading, sel, slug]);

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
      await trashPhotos(slug, [...selectedIds]);
      setRows((prev) => prev.filter((r) => !(r.photoId && selectedIds.has(r.photoId))));
      sel.clear();
      router.refresh();
    } catch {
      toast.error("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }, [sel, deleting, confirm, router, slug]);

  const summary = summarizeRows(rows);
  const hasRows = rows.length > 0;

  return (
    <>
      {confirmDialog}

      {sel.count > 0 ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.clear}
          actions={
            <>
              <ColorLabelMenu
                disabled={sel.count === 0 || labelPending}
                onPick={(l) => void applyLabel(l)}
              />
              <AddToAlbumMenu
                disabled={sel.count === 0}
                onPick={(albumId) => void album.addToAlbumDirect([...sel.selected], albumId)}
                onCreateNew={() => album.addToAlbum([...sel.selected])}
              />
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0 || downloading}
                onClick={() => void handleDownload()}
                aria-label="Download"
                title="Download"
              >
                {downloading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={sel.count === 0 || deleting}
                onClick={() => void handleDelete()}
                aria-label="Delete"
                title="Delete"
              >
                {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title="Upload"
          subtitle={
            targetAlbum ? (
              <span className="inline-flex items-center gap-1.5">
                <span>
                  Uploading to{" "}
                  <span className="font-medium text-foreground">{targetAlbum.name}</span>
                </span>
                <button
                  type="button"
                  onClick={clearTargetAlbum}
                  aria-label="Stop uploading to this album"
                  title="Stop uploading to this album"
                  className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ) : undefined
          }
          actions={
            hasRows ? <GridSizeMenu columns={columns} onColumnsChange={setColumns} /> : null
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
            {rows.map((row, index) => (
              <UploadTile
                key={row.id}
                id={row.id}
                index={index}
                photoId={row.photoId}
                name={row.name}
                status={row.status}
                message={row.message}
                colorLabel={row.colorLabel}
                selected={Boolean(row.photoId && sel.selected.has(row.photoId))}
                onTileClick={handleTileClick}
                onRetry={retryRow}
              />
            ))}
          </div>
        ) : null}
      </div>

      {album.element}
    </>
  );
}
