"use client";

import { useRef } from "react";
import { Download, FolderPlus, Loader2, SquareCheckBig, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "./selection-toolbar";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { HeaderBar } from "@/components/header-bar";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";

export function LibraryView() {
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({ gridRef });

  return (
    <>
      {actions.element}
      {sel.selectMode ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <>
              <ColorLabelMenu
                disabled={sel.count === 0 || actions.pending.label}
                onPick={(label) => void actions.applyLabel([...sel.selected], label)}
              />
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0}
                onClick={() => actions.addToAlbum([...sel.selected])}
                aria-label="Add to album"
                title="Add to album"
              >
                <FolderPlus aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.download}
                onClick={() => void actions.download([...sel.selected], { onSuccess: sel.clear })}
                aria-label="Download"
                title="Download"
              >
                {actions.pending.download ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.trash}
                onClick={() => void actions.trash([...sel.selected], { onSuccess: sel.cancel })}
                aria-label="Delete"
                title="Delete"
              >
                {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title="Library"
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
              <Button
                variant="outline"
                size="icon-sm"
                onClick={sel.enter}
                aria-label="Select"
                title="Select"
              >
                <SquareCheckBig aria-hidden />
              </Button>
            </>
          }
        />
      )}

      <PhotoCollectionProvider
        key={sort}
        endpoint="/api/photos"
        params={new URLSearchParams({ sort })}
        urlForId={(id) => photoHref(id, undefined, sort)}
        baseUrl="/photos"
      >
        <PhotoActionsProvider value={actions}>
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectMode={sel.selectMode}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
          />
          <Lightbox />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
