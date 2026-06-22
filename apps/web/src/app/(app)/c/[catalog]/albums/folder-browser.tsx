"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, FolderInput, FolderOpen, Images, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FolderContentsDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HeaderBar } from "@/components/header-bar";
import { GridSizeMenu } from "@/components/grid-size-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SelectionToolbar } from "@/components/photo-actions/selection-toolbar";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridSelectionNav } from "@/lib/use-grid-selection-nav";
import { useAlbumColumns } from "@/lib/use-album-columns";
import { ALBUM_DEFAULT_COLUMNS } from "@/lib/grid-layout";
import { countLabel } from "@/lib/count-label";
import { useConfirm } from "@/components/confirm-dialog";
import { invalidateLibraryTree } from "@/components/library-tree/library-tree";
import { partitionAlbums } from "@/lib/partition-albums";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { NewItemMenu } from "./new-item-menu";
import { AlbumCard } from "./album-card";
import { FolderCard } from "./folder-card";
import { RenameDialog } from "./rename-dialog";
import { MovePickerItems } from "./move-picker-items";
import { DeleteFolderDialog } from "./delete-folder-dialog";
import { FolderBrowserShortcuts } from "./folder-browser-shortcuts";

type Targets = { folderIds: string[]; albumIds: string[] };

export function FolderBrowser({ contents }: { contents: FolderContentsDTO }) {
  const router = useRouter();
  const { slug } = useCatalog();
  const sel = useGridSelection();
  const { columns, setColumns } = useAlbumColumns();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Targets | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rename, setRename] = useState<{ endpoint: string; name: string; label: string } | null>(null);

  const currentFolderId = contents.folder?.id ?? null;
  const { subfolders, albums } = contents;
  const { regular, smart } = partitionAlbums(albums);

  const folderIdSet = new Set(subfolders.map((f) => f.id));
  const selectedFolderIds = [...sel.selected].filter((id) => folderIdSet.has(id));
  const selectedAlbumIds = [...sel.selected].filter((id) => !folderIdSet.has(id));

  // Reading order across the three sections — the flat list the selection
  // reducer and arrow-key navigation index against.
  const orderedIds = [
    ...subfolders.map((f) => f.id),
    ...regular.map((a) => a.id),
    ...smart.map((a) => a.id),
  ];
  const indexOf = new Map(orderedIds.map((id, i) => [id, i]));

  const gridRef = useRef<HTMLDivElement>(null);

  function openFolder(id: string) {
    router.push(catalogPath(slug, `/albums/folder/${id}`));
  }
  function openAlbum(id: string) {
    router.push(catalogPath(slug, `/albums/${id}`));
  }
  function viewFolderPhotos(id: string) {
    router.push(catalogPath(slug, `/albums/folder/${id}/photos`));
  }

  function openItem(id: string) {
    if (folderIdSet.has(id)) openFolder(id);
    else openAlbum(id);
  }

  const { handleItemClick } = useGridSelectionNav({
    count: orderedIds.length,
    columns,
    idAt: (i) => orderedIds[i],
    getClickIds: () => orderedIds,
    selectedIds: sel.selected,
    onSelectionChange: sel.setSelected,
    // Enter-to-open is owned by <FolderBrowserShortcuts> (shared with the grid's
    // GridShortcuts); the nav hook only moves the selection.
    scrollToIndex: (i) => {
      const id = orderedIds[i];
      if (id) gridRef.current?.querySelector(`[data-card-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
    },
  });

  function onCardSelect(id: string, e: React.MouseEvent) {
    const i = indexOf.get(id);
    if (i !== undefined) handleItemClick(i, e);
  }

  /** Selection-aware: act on the whole selection when the item is selected, else just it. */
  function resolveTargets(id: string): Targets {
    const ids = sel.selected.has(id) ? [...sel.selected] : [id];
    return {
      folderIds: ids.filter((x) => folderIdSet.has(x)),
      albumIds: ids.filter((x) => !folderIdSet.has(x)),
    };
  }

  function startRename(id: string) {
    const folder = subfolders.find((f) => f.id === id);
    if (folder) {
      setRename({ endpoint: catalogApiUrl(slug, `/folders/${id}`), name: folder.name, label: "folder" });
      return;
    }
    const album = albums.find((a) => a.id === id);
    if (album) setRename({ endpoint: catalogApiUrl(slug, `/albums/${id}`), name: album.name, label: "album" });
  }

  async function doMove(targets: Targets, targetFolderId: string | null) {
    if (targets.folderIds.length === 0 && targets.albumIds.length === 0) return;
    try {
      const res = await fetch(catalogApiUrl(slug, "/folders/move"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          folderIds: targets.folderIds.length ? targets.folderIds : undefined,
          albumIds: targets.albumIds.length ? targets.albumIds : undefined,
          targetFolderId,
        }),
      });
      if (!res.ok) throw new Error();
      playSound(SoundEffect.ActionComplete);
      sel.clear();
      invalidateLibraryTree();
      router.refresh();
    } catch {
      toast.error("Failed to move.");
    }
  }

  async function performDelete(targets: Targets, mode: "reparent" | "cascade") {
    setBusy(true);
    try {
      await Promise.all([
        ...targets.folderIds.map((id) =>
          fetch(catalogApiUrl(slug, `/folders/${id}?mode=${mode}`), { method: "DELETE" }),
        ),
        targets.albumIds.length > 0
          ? fetch(catalogApiUrl(slug, "/albums"), {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ids: targets.albumIds }),
            })
          : Promise.resolve(),
      ]);
      setDeleteOpen(false);
      setPendingDelete(null);
      sel.clear();
      invalidateLibraryTree();
      router.refresh();
    } catch {
      toast.error("Failed to delete.");
    } finally {
      setBusy(false);
    }
  }

  async function requestDelete(targets: Targets) {
    if (busy) return;
    const count = targets.folderIds.length + targets.albumIds.length;
    if (count === 0) return;
    // A non-empty folder needs the keep/delete-contents/cancel choice (custom dialog).
    const nonEmptyFolder = targets.folderIds.some((id) => {
      const f = subfolders.find((x) => x.id === id);
      return !!f && (f.albumCount > 0 || f.childFolderCount > 0);
    });
    if (nonEmptyFolder) {
      setPendingDelete(targets);
      setDeleteOpen(true);
      return;
    }
    const ok = await confirm({
      title: `Delete ${count} ${count === 1 ? "item" : "items"}?`,
      description: "This can't be undone. Your photos stay in the library.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    void performDelete(targets, "reparent");
  }

  const isEmpty = subfolders.length === 0 && albums.length === 0;

  // Header title: a breadcrumb trail in the header's title slot (no separate bar).
  const titleNode =
    contents.breadcrumbs.length === 0 ? (
      "Albums"
    ) : (
      <span className="flex items-center gap-1">
        <Link
          href={catalogPath(slug, "/albums")}
          className="font-normal text-muted-foreground hover:text-foreground"
        >
          Albums
        </Link>
        {contents.breadcrumbs.map((crumb, i) => {
          const isLast = i === contents.breadcrumbs.length - 1;
          return (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {isLast ? (
                <span className="truncate">{crumb.name}</span>
              ) : (
                <Link
                  href={catalogPath(slug, `/albums/folder/${crumb.id}`)}
                  className="font-normal text-muted-foreground hover:text-foreground"
                >
                  {crumb.name}
                </Link>
              )}
            </span>
          );
        })}
      </span>
    );

  // Header subtitle: top level → folder/album/smart-album counts; in a folder → photo count.
  let subtitle: React.ReactNode = null;
  if (contents.folder === null) {
    const parts: string[] = [];
    if (subfolders.length > 0) parts.push(countLabel(subfolders.length, "folder", "folders"));
    if (regular.length > 0) parts.push(countLabel(regular.length, "album", "albums"));
    if (smart.length > 0) parts.push(countLabel(smart.length, "smart album", "smart albums"));
    subtitle = parts.length > 0 ? parts.join(" · ") : null;
  } else {
    subtitle = countLabel(contents.currentPhotoCount ?? 0, "photo", "photos");
  }

  return (
    <>
      <FolderBrowserShortcuts selectedIds={sel.selected} onEnter={openItem} />
      {confirmDialog}
      {rename && (
        <RenameDialog
          open
          onOpenChange={(v) => !v && setRename(null)}
          endpoint={rename.endpoint}
          currentName={rename.name}
          label={rename.label}
        />
      )}
      <DeleteFolderDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        count={pendingDelete?.folderIds.length ?? 0}
        pending={busy}
        onChoose={(mode) => pendingDelete && void performDelete(pendingDelete, mode)}
      />

      {sel.count > 0 ? (
        <SelectionToolbar
          title="Select items"
          count={sel.count}
          onCancel={sel.clear}
          actions={
            <>
              {sel.count === 1 && selectedFolderIds.length === 1 && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="View all photos"
                  title="View all photos"
                  onClick={() => viewFolderPhotos(selectedFolderIds[0])}
                >
                  <Images aria-hidden />
                </Button>
              )}
              {sel.count === 1 && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Rename"
                  title="Rename"
                  onClick={() => startRename([...sel.selected][0])}
                >
                  <Pencil aria-hidden />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Move to folder"
                    title="Move to…"
                  >
                    <FolderInput aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                  <DropdownMenuLabel>Move to…</DropdownMenuLabel>
                  <MovePickerItems
                    Item={DropdownMenuItem}
                    excludeSubtreeOf={selectedFolderIds.length === 1 ? selectedFolderIds[0] : undefined}
                    onPick={(target) =>
                      void doMove({ folderIds: selectedFolderIds, albumIds: selectedAlbumIds }, target)
                    }
                  />
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={busy}
                onClick={() => void requestDelete({ folderIds: selectedFolderIds, albumIds: selectedAlbumIds })}
                aria-label="Delete"
                title="Delete"
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title={titleNode}
          subtitle={subtitle}
          actions={
            <>
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <NewItemMenu parentId={currentFolderId} />
            </>
          }
        />
      )}

      {isEmpty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>Create a folder or an album to get started.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div ref={gridRef} className="space-y-8">
          {subfolders.length > 0 && (
            <Section title="Folders">
              {subfolders.map((f) => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  isSelected={sel.selected.has(f.id)}
                  onSelect={onCardSelect}
                  onOpen={openFolder}
                  onViewPhotos={viewFolderPhotos}
                  onRename={startRename}
                  onMove={(id, target) => void doMove(resolveTargets(id), target)}
                  onDelete={(id) => void requestDelete(resolveTargets(id))}
                />
              ))}
            </Section>
          )}
          {regular.length > 0 && (
            <Section title="Albums">
              {regular.map((a) => (
                <AlbumCard
                  key={a.id}
                  album={a}
                  isSelected={sel.selected.has(a.id)}
                  onSelect={onCardSelect}
                  onOpen={openAlbum}
                  onRename={startRename}
                  onMove={(id, target) => void doMove(resolveTargets(id), target)}
                  onDelete={(id) => void requestDelete(resolveTargets(id))}
                />
              ))}
            </Section>
          )}
          {smart.length > 0 && (
            <Section title="Smart Albums">
              {smart.map((a) => (
                <AlbumCard
                  key={a.id}
                  album={a}
                  isSelected={sel.selected.has(a.id)}
                  onSelect={onCardSelect}
                  onOpen={openAlbum}
                  onRename={startRename}
                  onMove={(id, target) => void doMove(resolveTargets(id), target)}
                  onDelete={(id) => void requestDelete(resolveTargets(id))}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div
        className="grid gap-x-5 gap-y-7"
        style={{ gridTemplateColumns: `repeat(var(--album-columns, ${ALBUM_DEFAULT_COLUMNS}), minmax(0, 1fr))` }}
      >
        {children}
      </div>
    </section>
  );
}
