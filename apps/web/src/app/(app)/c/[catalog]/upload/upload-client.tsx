"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGridSelectionNav } from "@/lib/hooks/use-grid-selection-nav";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Loader2, PanelRight, Trash2, X } from "lucide-react";
import type { ColorLabel } from "@lumio/shared";
import { errorMessage } from "@lumio/shared";
import { countLabel } from "@/lib/count-label";
import { postJson } from "@/lib/http";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HeaderBar } from "@/components/header-bar";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumMenu } from "@/components/photo-actions/add-to-album-menu";
import { useAddToAlbum } from "@/components/photo-actions/use-add-to-album";
import { useConfirm } from "@/components/confirm-dialog";
import { useGridSelection } from "@/lib/hooks/use-grid-selection";
import { useGridColumns } from "@/lib/hooks/use-grid-columns";
import { downloadSelection } from "@/lib/download-client";
import { setPhotoColorLabel, trashPhotos } from "@/lib/photo-mutations";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { partitionSupported } from "@/lib/upload-collect";
import { albumTargetIds, summarizeRows, type Row, type RowStatus } from "@/lib/upload-rows";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";
import { SelectionToolbar } from "@/components/photo-actions/selection-toolbar";
import { UploadDropzone } from "./upload-dropzone";
import { UploadCommandBar } from "./upload-command-bar";
import { UploadTile } from "./upload-tile";
import { UploadMetadataForm } from "./upload-metadata-form";

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
  // Batch-metadata side panel: off by default, toggled from the toolbar; only
  // available when the catalog actually has custom fields.
  const [showMeta, setShowMeta] = useState(false);
  const metaSchema = useCatalogMetadataSchema(slug);
  const hasMeta = (metaSchema ?? []).some((g) => g.fields.some((f) => f.enabled));
  const [metaValues, setMetaValues] = useState<Record<string, string>>({});
  const metaRef = useRef<Record<string, string>>({});
  const setMeta = useCallback((next: Record<string, string>) => {
    metaRef.current = next;
    setMetaValues(next);
  }, []);

  const update = useCallback((id: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, rowId: number): Promise<{ status: RowStatus; photoId?: string }> => {
      update(rowId, { status: "uploading", message: undefined });
      const body = new FormData();
      body.set("file", file);
      body.set("lastModified", String(file.lastModified));
      const filled = Object.entries(metaRef.current).filter(([, v]) => v.trim() !== "");
      if (filled.length > 0) {
        body.set("metadata", JSON.stringify(filled.map(([fieldId, value]) => ({ fieldId, value }))));
      }
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
        update(rowId, { status: "error", message: errorMessage(err) });
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
            await postJson(catalogApiUrl(slug, `/albums/${targetAlbum.id}/photos`), { photoIds: ids });
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

  // Reuses the shared selection driver so plain-toggle, shift-range, and arrow
  // key navigation match the photo grid. `getClickIds` returns the row's photoId
  // (or "" for not-yet-ingested rows, which computeSelection skips as falsy);
  // `idAt` returns undefined for those rows so arrow selection skips them too.
  const { handleItemClick: handleTileClick } = useGridSelectionNav(
    {
      count: rows.length,
      columns,
      idAt: (i) => rowsRef.current[i]?.photoId || undefined,
      getClickIds: () => rowsRef.current.map((r) => r.photoId ?? ""),
      selectedIds: sel.selected,
      onSelectionChange: sel.setSelected,
    },
    { enableKeyboard: false },
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
    const label = countLabel(selectedIds.size, "photo", "photos");
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

      <div className={cn("flex", showMeta && hasMeta && "h-[calc(100dvh-1.5rem)]")}>
        <div className="flex min-w-0 flex-1 flex-col">
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={sel.count === 0 || downloading}
                    onClick={() => void handleDownload()}
                    aria-label="Download"
                  >
                    {downloading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    disabled={sel.count === 0 || deleting}
                    onClick={() => void handleDelete()}
                    aria-label="Delete"
                  >
                    {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
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
            <div className="flex items-center gap-2">
              {hasMeta && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={showMeta ? "default" : "outline"}
                      size="icon-sm"
                      aria-pressed={showMeta}
                      onClick={() => setShowMeta((v) => !v)}
                      aria-label="Batch metadata"
                    >
                      <PanelRight aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Batch metadata</TooltipContent>
                </Tooltip>
              )}
              {hasRows && <GridSizeMenu columns={columns} onColumnsChange={setColumns} />}
            </div>
          }
        />
      )}

          <div className={cn("space-y-6 pt-2", showMeta && hasMeta && "flex-1 overflow-y-auto")}>
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
        </div>
        {showMeta && hasMeta && (
          <aside className="w-80 shrink-0 border-l">
            <ScrollArea className="h-full">
              <div className="p-4">
                <UploadMetadataForm values={metaValues} onChange={setMeta} />
              </div>
            </ScrollArea>
          </aside>
        )}
      </div>

      {album.element}
    </>
  );
}
