"use client";

import { useCallback, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { useGridSelection } from "@/lib/hooks/use-grid-selection";
import { useGridView } from "@/lib/hooks/use-grid-view";
import { useGridColumns } from "@/lib/hooks/use-grid-columns";
import {
  PhotoGrid,
  type PhotoGridHandle,
  PhotoCollectionProvider,
  CollectionTotalReporter,
} from "@/features/photo-grid";
import { Lightbox } from "@/features/lightbox";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";
import {
  PhotoCapabilitiesProvider,
} from "@/components/photo-actions/photo-capabilities";
import { CatalogProvider } from "@/components/providers/catalog-context";
import { countLabel } from "@/lib/count-label";
import { Skeleton } from "@/components/ui/skeleton";
import { sharePhotosEndpoint, shareDownloadAllUrl } from "@/lib/share-url";
import { ShareRenditionProvider } from "./share-rendition-provider";
import {
  PUBLIC_CAPABILITIES,
  useSharePhotoActions,
} from "./share-photo-actions";

const NO_PARAMS = new URLSearchParams();

/** The single "Download selected" button rendered in the selection toolbar. */
function DownloadSelectedButton({
  ids,
  pending,
  onDownload,
  onDone,
}: {
  ids: string[];
  pending: boolean;
  onDownload: (ids: string[], opts?: { onSuccess?: () => void }) => Promise<void>;
  onDone: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || ids.length === 0}
      onClick={() => void onDownload(ids, { onSuccess: onDone })}
    >
      <Download aria-hidden />
      Download
    </Button>
  );
}

/**
 * The public share gallery. Reuses the authed `PhotoGrid` + `Lightbox`, gated
 * down to a viewer's capabilities (browse / zoom / download only) via the
 * rendition, capabilities, and actions providers — no edit / info / favorite /
 * trash / album. The lightbox opens in-memory: `urlForId` returns the gallery's
 * own path, so open() pushes one history entry (back closes) and the share path
 * never reads as a `/photo/<id>` detail route, so no per-photo route is needed.
 */
export function ShareGalleryView({
  token,
  title,
}: {
  token: string;
  title: string | null;
}) {
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const [total, setTotal] = useState<number | null>(null);
  const gridRef = useRef<PhotoGridHandle>(null);

  const heading = title ?? "Shared photos";
  const actions = useSharePhotoActions(token, heading);

  const galleryPath = `/share/${encodeURIComponent(token)}`;
  // History stays on the gallery's own URL; no per-photo route exists publicly.
  const urlForId = useCallback(() => galleryPath, [galleryPath]);

  const totalLabel = total !== null ? countLabel(total, "photo", "photos") : undefined;
  const countSubtitle = totalLabel ?? (
    <Skeleton className="inline-block h-3 w-16 align-middle" />
  );

  return (
    <ShareRenditionProvider token={token}>
      <CatalogProvider catalog={{ id: "share", slug: token, name: heading }}>
        <PhotoCapabilitiesProvider value={PUBLIC_CAPABILITIES}>
          <PhotoActionsProvider value={actions}>
            <main className="mx-auto max-w-screen-2xl px-4 py-2">
              {/* Single sticky toolbar: the logo always leads it (it stays put when a
                  selection is active — only the subtitle + right-hand actions swap). */}
              <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-4 bg-background px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Logo className="size-8 shrink-0" />
                  <div className="min-w-0">
                    <h1 className="truncate text-sm font-semibold leading-tight">{heading}</h1>
                    <div className="text-xs text-muted-foreground">
                      {sel.count > 0 ? `${sel.count} selected` : countSubtitle}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {sel.count > 0 ? (
                    <>
                      <DownloadSelectedButton
                        ids={[...sel.selected]}
                        pending={actions.pending.download}
                        onDownload={actions.download}
                        onDone={sel.clear}
                      />
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={sel.clear}
                        aria-label="Clear selection"
                      >
                        <X aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <>
                      <GridViewMenu mode={mode} onModeChange={setMode} />
                      <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
                      {total !== null && total > 0 && (
                        <Button asChild variant="outline" size="sm">
                          <a href={shareDownloadAllUrl(token)} download>
                            <Download aria-hidden />
                            Download all
                          </a>
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <PhotoCollectionProvider
                endpoint={sharePhotosEndpoint(token)}
                params={NO_PARAMS}
                urlForId={urlForId}
                baseUrl={galleryPath}
              >
                <CollectionTotalReporter onTotal={setTotal} />
                <PhotoGrid
                  apiRef={gridRef}
                  mode={mode}
                  columns={columns}
                  selectedIds={sel.selected}
                  onSelectionChange={sel.setSelected}
                />
                <Lightbox />
              </PhotoCollectionProvider>
            </main>
          </PhotoActionsProvider>
        </PhotoCapabilitiesProvider>
      </CatalogProvider>
    </ShareRenditionProvider>
  );
}
