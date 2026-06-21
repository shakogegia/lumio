"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, FolderInput, Images, Loader2, Pencil, Trash2 } from "lucide-react";
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
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useAlbumColumns } from "@/lib/use-album-columns";
import { ALBUM_DEFAULT_COLUMNS } from "@/lib/grid-layout";
import { useConfirm } from "@/components/confirm-dialog";
import { partitionAlbums } from "@/lib/partition-albums";
import { NewAlbumDialog } from "./new-album-dialog";
import { NewFolderDialog } from "./new-folder-dialog";
import { AlbumCard } from "./album-card";
import { FolderCard } from "./folder-card";
import { FolderBreadcrumbs } from "./folder-breadcrumbs";
import { RenameDialog } from "./rename-dialog";
import { MoveToFolderDialog } from "./move-to-folder-dialog";
import { DeleteFolderDialog } from "./delete-folder-dialog";

export function FolderBrowser({ contents }: { contents: FolderContentsDTO }) {
  const router = useRouter();
  const sel = useGridSelection();
  const { columns, setColumns } = useAlbumColumns();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rename, setRename] = useState<{ endpoint: string; name: string; label: string } | null>(null);

  const currentFolderId = contents.folder?.id ?? null;
  const { subfolders, albums } = contents;
  const { regular, smart } = partitionAlbums(albums);

  const folderIdSet = new Set(subfolders.map((f) => f.id));
  const selectedFolderIds = [...sel.selected].filter((id) => folderIdSet.has(id));
  const selectedAlbumIds = [...sel.selected].filter((id) => !folderIdSet.has(id));
  const selectedFolderNonEmpty = subfolders.some(
    (f) => selectedFolderIds.includes(f.id) && (f.albumCount > 0 || f.childFolderCount > 0),
  );

  function toggle(id: string) {
    sel.setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function openFolder(id: string) {
    router.push(`/albums/folder/${id}`);
  }
  function openAlbum(id: string) {
    router.push(`/albums/${id}`);
  }

  async function performDelete(mode: "reparent" | "cascade") {
    setBusy(true);
    try {
      await Promise.all([
        ...selectedFolderIds.map((id) =>
          fetch(`/api/folders/${id}?mode=${mode}`, { method: "DELETE" }),
        ),
        selectedAlbumIds.length > 0
          ? fetch("/api/albums", {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ids: selectedAlbumIds }),
            })
          : Promise.resolve(),
      ]);
      setDeleteOpen(false);
      sel.clear();
      router.refresh();
    } catch {
      toast.error("Failed to delete.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy || sel.count === 0) return;
    if (selectedFolderNonEmpty) {
      setDeleteOpen(true);
      return;
    }
    const ok = await confirm({
      title: `Delete ${sel.count} ${sel.count === 1 ? "item" : "items"}?`,
      description: "This can't be undone. Your photos stay in the library.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    void performDelete("reparent");
  }

  const isEmpty = subfolders.length === 0 && albums.length === 0;

  return (
    <>
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
      <MoveToFolderDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        folderIds={selectedFolderIds}
        albumIds={selectedAlbumIds}
        onMoved={sel.clear}
      />
      <DeleteFolderDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        count={selectedFolderIds.length}
        pending={busy}
        onChoose={(mode) => void performDelete(mode)}
      />

      {contents.breadcrumbs.length > 0 && <FolderBreadcrumbs breadcrumbs={contents.breadcrumbs} />}

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
                  onClick={() => router.push(`/albums/folder/${selectedFolderIds[0]}/photos`)}
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
                  onClick={() => {
                    const id = [...sel.selected][0];
                    const folder = subfolders.find((f) => f.id === id);
                    if (folder) {
                      setRename({ endpoint: `/api/folders/${id}`, name: folder.name, label: "folder" });
                    } else {
                      const album = albums.find((a) => a.id === id);
                      if (album) setRename({ endpoint: `/api/albums/${id}`, name: album.name, label: "album" });
                    }
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Move to folder"
                title="Move to…"
                onClick={() => setMoveOpen(true)}
              >
                <FolderInput aria-hidden />
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={busy}
                onClick={() => void handleDelete()}
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
          title={contents.folder?.name ?? "Albums"}
          actions={
            <>
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <NewFolderDialog parentId={currentFolderId} />
              <NewAlbumDialog folderId={currentFolderId} />
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
        <div className="space-y-8">
          {subfolders.length > 0 && (
            <Section title="Folders">
              {subfolders.map((f) => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  isSelected={sel.selected.has(f.id)}
                  onToggle={toggle}
                  onOpen={openFolder}
                />
              ))}
            </Section>
          )}
          {regular.length > 0 && (
            <Section title="Albums">
              {regular.map((a) => (
                <AlbumCard key={a.id} album={a} isSelected={sel.selected.has(a.id)} onToggle={toggle} onOpen={openAlbum} />
              ))}
            </Section>
          )}
          {smart.length > 0 && (
            <Section title="Smart Albums">
              {smart.map((a) => (
                <AlbumCard key={a.id} album={a} isSelected={sel.selected.has(a.id)} onToggle={toggle} onOpen={openAlbum} />
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
