import type { AlbumSummaryDTO, FolderDTO } from "@lumio/shared";

export type AlbumPickerRow =
  | { kind: "folder"; id: string; name: string; depth: number }
  | { kind: "album"; album: AlbumSummaryDTO; depth: number };

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

function groupFolders(folders: FolderDTO[]): Map<string | null, FolderDTO[]> {
  const byParent = new Map<string | null, FolderDTO[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  return byParent;
}

/**
 * Ordered, depth-tagged rows mirroring the folder tree: top-level albums first, then
 * each folder as a header with its albums indented beneath. Used by the "Add to album"
 * picker (defaults: hide smart albums, hide folders with no pickable album) and the
 * sidebar flyout (`includeSmart` + `includeEmptyFolders` to show the full nav tree).
 */
export function buildAlbumPickerRows(
  folders: FolderDTO[],
  albums: AlbumSummaryDTO[],
  opts: { excludeAlbumId?: string; includeSmart?: boolean; includeEmptyFolders?: boolean } = {},
): AlbumPickerRow[] {
  const pickable = albums.filter(
    (a) => (opts.includeSmart || !a.isSmart) && a.id !== opts.excludeAlbumId,
  );
  const albumsByFolder = new Map<string | null, AlbumSummaryDTO[]>();
  for (const a of pickable) {
    const arr = albumsByFolder.get(a.folderId) ?? [];
    arr.push(a);
    albumsByFolder.set(a.folderId, arr);
  }
  const childFolders = groupFolders(folders);

  // Which folders have a pickable album somewhere in their subtree?
  const hasAlbum = new Set<string>();
  const visit = (id: string): boolean => {
    let found = (albumsByFolder.get(id) ?? []).length > 0;
    for (const c of childFolders.get(id) ?? []) {
      if (visit(c.id)) found = true;
    }
    if (found) hasAlbum.add(id);
    return found;
  };
  for (const f of childFolders.get(null) ?? []) visit(f.id);

  const rows: AlbumPickerRow[] = [];
  for (const a of (albumsByFolder.get(null) ?? []).slice().sort(byName)) {
    rows.push({ kind: "album", album: a, depth: 0 });
  }
  const walk = (parentId: string | null, depth: number) => {
    for (const f of (childFolders.get(parentId) ?? []).slice().sort(byName)) {
      if (!opts.includeEmptyFolders && !hasAlbum.has(f.id)) continue;
      rows.push({ kind: "folder", id: f.id, name: f.name, depth });
      for (const a of (albumsByFolder.get(f.id) ?? []).slice().sort(byName)) {
        rows.push({ kind: "album", album: a, depth: depth + 1 });
      }
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export interface FolderPickerRow {
  id: string;
  name: string;
  depth: number;
  disabled: boolean;
}

/**
 * Ordered, depth-tagged folder rows for the "Move to…" picker. `excludeSubtreeOf`
 * (a folder being moved) disables that folder and all its descendants so it can't be
 * moved into itself or a child (the server enforces this too).
 */
export function buildFolderPickerRows(
  folders: FolderDTO[],
  opts: { excludeSubtreeOf?: string } = {},
): FolderPickerRow[] {
  const childFolders = groupFolders(folders);
  const disabled = new Set<string>();
  if (opts.excludeSubtreeOf) {
    const stack = [opts.excludeSubtreeOf];
    while (stack.length) {
      const id = stack.pop() as string;
      disabled.add(id);
      for (const c of childFolders.get(id) ?? []) stack.push(c.id);
    }
  }
  const rows: FolderPickerRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of (childFolders.get(parentId) ?? []).slice().sort(byName)) {
      rows.push({ id: f.id, name: f.name, depth, disabled: disabled.has(f.id) });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
